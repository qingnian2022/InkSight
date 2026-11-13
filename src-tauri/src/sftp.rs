//! SFTP 客户端：连接 / 列目录 / 下载。
//!
//! 走纯 Rust 的 `russh` + `russh-sftp`，不依赖系统 OpenSSH，也不用 libssh2 的 C 构建。
//! 每个连接在会话表里留一个 `Handle`（掉线就靠它保活），SFTP 通道用 `tokio::Mutex`
//! 串行化 —— SFTP 协议本身对同一通道的并发请求有顺序要求，串行最稳。
//!
//! 密码不落盘：只活在这次连接里。配置文件（主机 / 端口 / 用户 / 私钥路径）由前端存
//! localStorage，所以重启后需要重新输入密码 —— 这是刻意的。

use russh::client::{self, Handle};
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};
use tokio::sync::Mutex as AsyncMutex;

struct Client;

impl client::Handler for Client {
    type Error = russh::Error;

    /// 首次连接直接接受主机密钥。
    /// 个人工具不做 known_hosts 比对，但也不会把连接信息发到别处 —— 风险写在界面上。
    async fn check_server_key(
        &mut self,
        _key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

struct Conn {
    /// 持有它才算连接活着；drop 就断开
    _handle: Handle<Client>,
    sftp: AsyncMutex<SftpSession>,
}

#[derive(Default)]
pub struct SftpState {
    next_id: AtomicU32,
    conns: Mutex<HashMap<u32, Arc<Conn>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    name: String,
    path: String,
    dir: bool,
    size: u64,
    /// unix 秒，0 表示服务器没给
    modified: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpListing {
    /// 解析后的绝对路径，面包屑用它
    path: String,
    entries: Vec<SftpEntry>,
}

async fn conn_of(state: &State<'_, SftpState>, id: u32) -> Result<Arc<Conn>, String> {
    let guard = state.conns.lock().map_err(|_| "SFTP 状态不可用".to_string())?;
    guard.get(&id).cloned().ok_or_else(|| "连接已断开".to_string())
}

#[tauri::command]
pub async fn sftp_connect(
    state: State<'_, SftpState>,
    host: String,
    port: u16,
    user: String,
    password: Option<String>,
    key_path: Option<String>,
    passphrase: Option<String>,
) -> Result<u32, String> {
    let host = host.trim().to_string();
    if host.is_empty() {
        return Err("主机不能为空".to_string());
    }

    let config = Arc::new(client::Config::default());
    let mut handle = client::connect(config, (host.as_str(), port), Client)
        .await
        .map_err(|e| format!("连接 {host}:{port} 失败：{e}"))?;

    let key = key_path.filter(|p| !p.trim().is_empty());
    let auth = match key {
        Some(path) => {
            let secret =
                load_secret_key(&path, passphrase.as_deref()).map_err(|e| format!("读取私钥失败：{e}"))?;
            handle
                .authenticate_publickey(
                    user.clone(),
                    PrivateKeyWithHashAlg::new(Arc::new(secret), None),
                )
                .await
                .map_err(|e| format!("认证失败：{e}"))?
        }
        None => handle
            .authenticate_password(user.clone(), password.unwrap_or_default())
            .await
            .map_err(|e| format!("认证失败：{e}"))?,
    };

    if !matches!(auth, client::AuthResult::Success) {
        return Err("认证被拒绝：请检查用户名、密码或私钥".to_string());
    }

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("打开会话通道失败：{e}"))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("启动 SFTP 子系统失败：{e}"))?;
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("初始化 SFTP 失败：{e}"))?;

    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let mut guard = state.conns.lock().map_err(|_| "SFTP 状态不可用".to_string())?;
    guard.insert(
        id,
        Arc::new(Conn {
            _handle: handle,
            sftp: AsyncMutex::new(sftp),
        }),
    );
    Ok(id)
}

#[tauri::command]
pub async fn sftp_list(
    state: State<'_, SftpState>,
    id: u32,
    path: String,
) -> Result<SftpListing, String> {
    let conn = conn_of(&state, id).await?;
    let sftp = conn.sftp.lock().await;

    // 空路径 = 家目录；canonicalize 把 "." 解析成绝对路径，面包屑才显示得对
    let abs = if path.trim().is_empty() {
        sftp.canonicalize(".").await.map_err(|e| format!("定位家目录失败：{e}"))?
    } else {
        path
    };

    let read_dir = sftp
        .read_dir(abs.as_str())
        .await
        .map_err(|e| format!("读取目录失败：{e}"))?;
    let mut entries: Vec<SftpEntry> = Vec::new();
    for item in read_dir {
        let meta = item.metadata();
        entries.push(SftpEntry {
            name: item.file_name(),
            path: item.path(),
            dir: meta.is_dir(),
            size: meta.size.unwrap_or(0),
            modified: meta.mtime.unwrap_or(0) as u64,
        });
    }
    // 目录优先，再按名称（忽略大小写），与资源管理器一致
    entries.sort_by(|a, b| {
        b.dir
            .cmp(&a.dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(SftpListing { path: abs, entries })
}

/// 本地重名时补 ` (2)`、` (3)`，不覆盖已有文件
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let mut target = dir.join(name);
    if !target.exists() {
        return target;
    }
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let ext = path.extension().and_then(|s| s.to_str());
    for index in 2..1000 {
        let candidate = match ext {
            Some(ext) => dir.join(format!("{stem} ({index}).{ext}")),
            None => dir.join(format!("{stem} ({index})")),
        };
        if !candidate.exists() {
            target = candidate;
            break;
        }
    }
    target
}

async fn download_to(
    sftp: &SftpSession,
    remote: &str,
    local: &Path,
) -> Result<u64, String> {
    let meta = sftp
        .symlink_metadata(remote)
        .await
        .map_err(|e| format!("读取远端信息失败：{e}"))?;

    if meta.is_dir() {
        tokio::fs::create_dir_all(local)
            .await
            .map_err(|e| format!("创建本地目录失败：{e}"))?;
        let mut total = 0u64;
        let read_dir = sftp
            .read_dir(remote)
            .await
            .map_err(|e| format!("读取远端目录失败：{e}"))?;
        for item in read_dir {
            let name = item.file_name();
            let child_remote = format!("{}/{}", remote.trim_end_matches('/'), name);
            let child_local = local.join(&name);
            // 递归要走 Box::pin：async fn 不能直接递归
            total += Box::pin(download_to(sftp, &child_remote, &child_local)).await?;
        }
        return Ok(total);
    }

    let mut source = sftp
        .open(remote)
        .await
        .map_err(|e| format!("打开远端文件失败：{e}"))?;
    if let Some(parent) = local.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建本地目录失败：{e}"))?;
    }
    let mut sink = tokio::fs::File::create(local)
        .await
        .map_err(|e| format!("创建本地文件失败：{e}"))?;
    tokio::io::copy(&mut source, &mut sink)
        .await
        .map_err(|e| format!("写入本地文件失败：{e}"))
}

/// 把远端文件 / 目录下载到 `local_dir`，返回落地的本地路径
#[tauri::command]
pub async fn sftp_download(
    state: State<'_, SftpState>,
    id: u32,
    remote_path: String,
    local_dir: String,
) -> Result<String, String> {
    let conn = conn_of(&state, id).await?;
    let sftp = conn.sftp.lock().await;

    let dir = PathBuf::from(&local_dir);
    if !dir.is_dir() {
        return Err(format!("本地目录不存在：{local_dir}"));
    }
    let name = remote_path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("download");
    let target = unique_path(&dir, name);

    download_to(&sftp, &remote_path, &target).await?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn sftp_disconnect(state: State<'_, SftpState>, id: u32) -> Result<(), String> {
    let removed = {
        let mut guard = state.conns.lock().map_err(|_| "SFTP 状态不可用".to_string())?;
        guard.remove(&id)
    };
    // 离开作用域后 Handle 被 drop，连接随之断开
    drop(removed);
    Ok(())
}

/* ---------- 连接配置（含密码，明文存数据目录） ---------- */

/// 连接配置。密码按用户要求一并落盘，**明文**保存在 `<数据目录>/.sftp.json`。
/// 该文件以点开头，知识库扫描会跳过，不会出现在笔记目录树里。
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProfile {
    id: String,
    name: String,
    host: String,
    port: u16,
    user: String,
    key_path: String,
    password: String,
}

fn profile_file(app: &AppHandle) -> Result<PathBuf, String> {
    let vault = crate::app_paths::resolve_vault_dir(app)?;
    Ok(vault.path.join(".sftp.json"))
}

#[tauri::command]
pub fn sftp_profiles_load(app: AppHandle) -> Result<Vec<StoredProfile>, String> {
    let path = profile_file(&app)?;
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("读取连接配置失败：{e}"))?;
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&text).map_err(|e| format!("解析连接配置失败：{e}"))
}

#[tauri::command]
pub fn sftp_profiles_save(app: AppHandle, profiles: Vec<StoredProfile>) -> Result<(), String> {
    let path = profile_file(&app)?;
    let text = serde_json::to_string_pretty(&profiles).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("保存连接配置失败：{e}"))
}

/// 递归删除：先清空子项再删目录（SFTP 的 rmdir 只接受空目录）
async fn remove_recursive(sftp: &SftpSession, path: &str) -> Result<(), String> {
    let meta = sftp
        .symlink_metadata(path)
        .await
        .map_err(|e| format!("读取远端信息失败：{e}"))?;
    if meta.is_dir() {
        let read = sftp
            .read_dir(path)
            .await
            .map_err(|e| format!("读取远端目录失败：{e}"))?;
        let mut children: Vec<String> = Vec::new();
        for item in read {
            children.push(item.file_name());
        }
        for name in children {
            let child = format!("{}/{}", path.trim_end_matches('/'), name);
            Box::pin(remove_recursive(sftp, &child)).await?;
        }
        sftp.remove_dir(path)
            .await
            .map_err(|e| format!("删除目录失败：{e}"))
    } else {
        sftp.remove_file(path)
            .await
            .map_err(|e| format!("删除文件失败：{e}"))
    }
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, SftpState>,
    id: u32,
    from: String,
    to: String,
) -> Result<(), String> {
    let conn = conn_of(&state, id).await?;
    let sftp = conn.sftp.lock().await;
    sftp.rename(from.as_str(), to.as_str())
        .await
        .map_err(|e| format!("重命名失败：{e}"))
}

#[tauri::command]
pub async fn sftp_remove(
    state: State<'_, SftpState>,
    id: u32,
    path: String,
) -> Result<(), String> {
    let conn = conn_of(&state, id).await?;
    let sftp = conn.sftp.lock().await;
    remove_recursive(&sftp, &path).await
}
