//! 文档读写：读有 20MB 上限；写为原子写（临时文件 + rename）。

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_DOC_BYTES: u64 = 20 * 1024 * 1024;

#[tauri::command(rename_all = "camelCase")]
pub fn doc_read(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let meta = std::fs::metadata(&p).map_err(|e| format!("E_IO: {e}"))?;
    if meta.len() > MAX_DOC_BYTES {
        return Err("E_TOO_LARGE: 文档超过 20MB".into());
    }
    let bytes = std::fs::read(&p).map_err(|e| format!("E_IO: {e}"))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// 原子写入：先写同目录临时文件，再 rename 覆盖，避免半截文件。
#[tauri::command(rename_all = "camelCase")]
pub fn doc_write(path: String, content: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let parent = target
        .parent()
        .ok_or_else(|| "E_INVALID_ARG: 路径没有父目录".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("E_IO: {e}"))?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let tmp = parent.join(format!(".md-rust-{}-{stamp}.tmp", std::process::id()));

    std::fs::write(&tmp, content.as_bytes()).map_err(|e| format!("E_IO: {e}"))?;
    if let Err(e) = std::fs::rename(&tmp, &target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("E_IO: {e}"));
    }
    Ok(())
}
