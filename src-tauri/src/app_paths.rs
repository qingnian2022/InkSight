//! 应用级路径与信息：数据目录解析、资源管理器打开、版本信息。

use serde::Serialize;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

#[tauri::command(rename_all = "camelCase")]
pub fn app_info() -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "name": "见字如面"
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDirInfo {
    path: String,
    fallback: bool,
}

/// 解析内置数据目录：优先 `<exe 目录>/data`（便携模式），exe 路径拿不到
/// 或目录不可写（如装进 Program Files）则降级到
/// `%APPDATA%/<identifier>/data`。目录不存在时自动创建。
///
/// 注意：不能用 Tauri 的 `BaseDirectory::Executable`——它底层是
/// `dirs::executable_dir()`，在 Windows 上恒为 None（XDG 语义），
/// 必报 "unknown path"；这里直接用 `current_exe()`。
#[tauri::command]
pub fn data_dir(app: tauri::AppHandle) -> Result<DataDirInfo, String> {
    let primary = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|d| d.to_path_buf()))
        .map(|dir| dir.join("data"));
    if let Some(primary) = primary {
        if std::fs::create_dir_all(&primary).is_ok() {
            return Ok(DataDirInfo {
                path: primary.to_string_lossy().into_owned(),
                fallback: false,
            });
        }
    }
    let fallback = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("E_PATH: {e}"))?
        .join("data");
    std::fs::create_dir_all(&fallback).map_err(|e| format!("E_IO: {e}"))?;
    Ok(DataDirInfo {
        path: fallback.to_string_lossy().into_owned(),
        fallback: true,
    })
}

/// 在资源管理器中打开数据目录。
#[tauri::command(rename_all = "camelCase")]
pub fn open_data_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("E_OPENER: {e}"))
}
