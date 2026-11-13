//! 内置终端：系统 PowerShell + Windows ConPTY（portable-pty）。
//!
//! 为什么不用 `std::process::Command` 接管道：
//! 管道里的 PowerShell 会退化成非交互模式 —— 没有提示符、没有输入回显、
//! 没有 PSReadLine 的行编辑与历史，Ctrl+C 也传不进去。ConPTY 给它一个真正的
//! 控制台，颜色、补全、宽度、Ctrl+C 全部与系统终端一致。
//!
//! 输出是原始字节流（ConPTY 统一按 UTF-8 吐出）。分块时可能切断一个多字节
//! 字符，所以留一个 carry 缓冲，把不完整的尾巴拼到下一块再发，避免中文变乱码。
//!
//! 每个会话一个读线程；写、改尺寸、关闭都走命令，按 id 从表里取。

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// 一帧终端输出。id 让前端把数据分发到对应的 xterm 实例。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TermChunk {
    id: u32,
    data: String,
}

/// 子进程结束（正常退出或被 kill）。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TermExit {
    id: u32,
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

/// 会话表。前端只用 u32 id 打交道，句柄不跨界。
#[derive(Default)]
pub struct TermState {
    sessions: Mutex<HashMap<u32, Session>>,
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        // 下限防止前端在收起的容器里 fit 出 0 列 / 0 行，那是会 panic 的
        rows: rows.max(2),
        cols: cols.max(10),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// 主盘符根目录（通常是 `C:\`）。终端默认落在这里，而不是安装目录或知识库目录 ——
/// 那两处都是应用自己的地盘，用户随手 `dir` 只会看到一堆程序文件。
fn default_drive() -> Option<PathBuf> {
    let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());
    let root = PathBuf::from(format!("{drive}\\"));
    root.is_dir().then_some(root)
}

/// PSReadLine 的历史文件（`%APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt`）。
/// 这是用户真实敲过的命令，跨窗口、跨启动都在 —— 前端的回显建议就是拿它做前缀匹配。
///
/// 注意：不能用 PSReadLine 的 InlineView 做这件事。系统自带的 Windows PowerShell 5.1
/// 配的是 PSReadLine 2.0.0，`PredictionViewStyle` 要 2.2 才有，设了也只会静默失败。
fn history_path() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    Some(
        PathBuf::from(appdata)
            .join("Microsoft")
            .join("Windows")
            .join("PowerShell")
            .join("PSReadLine")
            .join("ConsoleHost_history.txt"),
    )
}

/// 读历史命令，最新的在前。文件不存在时返回空表（第一次用 PowerShell 的正常状态）。
#[tauri::command]
pub fn term_history(limit: Option<usize>) -> Result<Vec<String>, String> {
    let limit = limit.unwrap_or(300).clamp(1, 1000);
    let Some(path) = history_path() else {
        return Ok(Vec::new());
    };
    if !path.is_file() {
        return Ok(Vec::new());
    }

    let bytes = std::fs::read(&path).map_err(|e| format!("读取历史记录失败：{e}"))?;
    // 不同版本 / 不同区域的 PowerShell 写出的编码不一样：优先认 BOM，其余按 UTF-8 容错
    let text = if bytes.starts_with(&[0xFF, 0xFE]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        String::from_utf8_lossy(&bytes[3..]).to_string()
    } else {
        String::from_utf8_lossy(&bytes).to_string()
    };

    let mut items: Vec<String> = Vec::new();
    for line in text.lines() {
        let cmd = line.trim_end();
        if cmd.is_empty() {
            continue;
        }
        // 连续重复（狂按同一条命令）只留一条
        if items.last().map(|last| last == cmd).unwrap_or(false) {
            continue;
        }
        items.push(cmd.to_string());
    }

    Ok(items.into_iter().rev().take(limit).collect())
}

/// id 由前端分配并先挂好 xterm，再调这里启动进程。
/// 反过来（后端分配 id）会丢掉第一屏输出 —— PowerShell 的提示符往往在
/// `term_open` 返回之前就写进了 PTY，那时前端还没有对应的实例可写。
#[tauri::command]
pub fn term_open(
    app: AppHandle,
    state: State<'_, TermState>,
    id: u32,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<(), String> {
    {
        let map = state.sessions.lock().map_err(|_| "终端状态不可用".to_string())?;
        if map.contains_key(&id) {
            return Err("终端会话 id 重复".to_string());
        }
    }

    let pair = native_pty_system()
        .openpty(size(cols, rows))
        .map_err(|e| format!("打开伪终端失败：{e}"))?;

    let mut cmd = CommandBuilder::new("powershell.exe");
    // -NoLogo 只去掉版权横幅，用户自己的 profile（别名 / 函数）照常加载
    cmd.arg("-NoLogo");
    cmd.env("TERM", "xterm-256color");
    if let Some(dir) = cwd.filter(|d| !d.trim().is_empty()) {
        let path = PathBuf::from(dir);
        if path.is_dir() {
            cmd.cwd(path);
        }
    } else if let Some(root) = default_drive() {
        cmd.cwd(root);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("启动 PowerShell 失败：{e}"))?;
    // 关掉 slave 端，否则读线程永远等不到 EOF
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("读取终端输出失败：{e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("写入终端失败：{e}"))?;

    let handle = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut carry: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    carry.extend_from_slice(&buf[..n]);
                    // 先判断整块是否合法 UTF-8：不合法时只放行合法的前缀，
                    // 最多留 3 字节（一个多字节字符的最大长度）等下一块。
                    let (text, keep) = match std::str::from_utf8(&carry) {
                        Ok(_) => (String::from_utf8_lossy(&carry).to_string(), carry.len()),
                        Err(err) => {
                            let valid = err.valid_up_to();
                            if carry.len() - valid > 3 {
                                (String::from_utf8_lossy(&carry).to_string(), carry.len())
                            } else {
                                (String::from_utf8_lossy(&carry[..valid]).to_string(), valid)
                            }
                        }
                    };
                    carry.drain(..keep);
                    if !text.is_empty() {
                        let _ = handle.emit("term://data", TermChunk { id, data: text });
                    }
                }
                Err(_) => break,
            }
        }
        let _ = handle.emit("term://exit", TermExit { id });
    });

    let mut map = state.sessions.lock().map_err(|_| "终端状态不可用".to_string())?;
    map.insert(
        id,
        Session {
            master: pair.master,
            writer,
            child,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn term_write(state: State<'_, TermState>, id: u32, data: String) -> Result<(), String> {
    let mut map = state.sessions.lock().map_err(|_| "终端状态不可用".to_string())?;
    let session = map.get_mut(&id).ok_or_else(|| "终端会话已关闭".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn term_resize(
    state: State<'_, TermState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = state.sessions.lock().map_err(|_| "终端状态不可用".to_string())?;
    let session = map.get(&id).ok_or_else(|| "终端会话已关闭".to_string())?;
    session.master.resize(size(cols, rows)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn term_close(state: State<'_, TermState>, id: u32) -> Result<(), String> {
    let mut map = state.sessions.lock().map_err(|_| "终端状态不可用".to_string())?;
    if let Some(mut session) = map.remove(&id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}
