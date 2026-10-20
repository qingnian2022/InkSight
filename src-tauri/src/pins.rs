//! 置顶列表：持久化在数据根目录的 `.md-rust.json`（点开头，目录树不扫描；随 git 同步）。

use std::path::{Path, PathBuf};

const PINS_FILE: &str = ".md-rust.json";
/// 虚拟「置顶」文件夹的路径哨兵（:: 在 Windows 文件名里非法，不会与真实路径冲突）
pub(crate) const PINNED_FOLDER_PATH: &str = "::pinned::";

fn pins_file(root: &Path) -> PathBuf {
    root.join(PINS_FILE)
}

/// 读取置顶路径列表；文件缺失或格式损坏时视为空。
pub(crate) fn load_pins(root: &Path) -> Vec<String> {
    let raw = std::fs::read_to_string(pins_file(root)).unwrap_or_default();
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| serde_json::from_value::<Vec<String>>(v.get("pinned")?.clone()).ok())
        .unwrap_or_default()
}

pub(crate) fn save_pins(root: &Path, pins: &[String]) -> Result<(), String> {
    let json = serde_json::json!({ "pinned": pins });
    std::fs::write(
        pins_file(root),
        serde_json::to_string_pretty(&json).map_err(|e| format!("E_IO: {e}"))?,
    )
    .map_err(|e| format!("E_IO: {e}"))
}

/// 读取置顶列表（数据根 .md-rust.json）。
#[tauri::command(rename_all = "camelCase")]
pub fn pin_list(root: String) -> Result<Vec<String>, String> {
    Ok(load_pins(&PathBuf::from(&root)))
}

/// 保存置顶列表（整表覆盖，前端 togglePin 计算好后传入）。
#[tauri::command(rename_all = "camelCase")]
pub fn pin_set(root: String, paths: Vec<String>) -> Result<(), String> {
    save_pins(&PathBuf::from(&root), &paths)
}
