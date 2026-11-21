//! 本地文件系统：给 SFTP 页面左栏用。
//!
//! 只做「列目录」和「盘符枚举」，读写在下载命令里直接落到目标路径，
//! 所以不需要单独的 mkdir / copy —— 下载时由 `sftp_download` 的 `create_dir_all` 兜住。

use serde::Serialize;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEntry {
    name: String,
    path: String,
    dir: bool,
    size: u64,
    modified: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalListing {
    /// 空串表示「此电脑」（盘符列表）
    path: String,
    entries: Vec<LocalEntry>,
}

fn drives() -> Vec<LocalEntry> {
    let mut out = Vec::new();
    for letter in b'A'..=b'Z' {
        let root = format!("{}:\\", letter as char);
        if Path::new(&root).is_dir() {
            out.push(LocalEntry {
                name: root.clone(),
                path: root,
                dir: true,
                size: 0,
                modified: 0,
            });
        }
    }
    out
}

#[tauri::command]
pub fn local_list(path: String) -> Result<LocalListing, String> {
    if path.trim().is_empty() {
        return Ok(LocalListing {
            path: String::new(),
            entries: drives(),
        });
    }

    let dir = Path::new(&path);
    let read = std::fs::read_dir(dir).map_err(|e| format!("读取本地目录失败：{e}"))?;
    let mut entries: Vec<LocalEntry> = Vec::new();
    for item in read {
        let Ok(item) = item else { continue };
        let Ok(meta) = item.metadata() else { continue };
        let name = item.file_name().to_string_lossy().to_string();
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        entries.push(LocalEntry {
            path: item.path().to_string_lossy().to_string(),
            name,
            dir: meta.is_dir(),
            size: if meta.is_dir() { 0 } else { meta.len() },
            modified,
        });
    }
    entries.sort_by(|a, b| {
        b.dir
            .cmp(&a.dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(LocalListing { path, entries })
}

#[tauri::command]
pub fn local_mkdir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("创建本地文件夹失败：{e}"))
}

/// 删除本地文件 / 目录。目录递归删；调用方必须先弹确认（不进回收站）。
#[tauri::command]
pub fn local_remove(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    let result = if target.is_dir() {
        std::fs::remove_dir_all(target)
    } else {
        std::fs::remove_file(target)
    };
    result.map_err(|e| format!("删除失败：{e}"))
}

#[tauri::command]
pub fn local_read_text(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("读取文件失败：{e}"))?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("文件超过 16 MB，暂不支持在表格里打开".to_string());
    }
    // Excel 导出的 CSV 常带 BOM，去掉，否则首列表头会多一个不可见字符
    let text = String::from_utf8_lossy(&bytes).to_string();
    Ok(text.trim_start_matches('\u{feff}').to_string())
}

#[tauri::command]
pub fn local_write_text(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("写入文件失败：{e}"))
}
