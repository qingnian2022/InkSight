//! 图片资源导入：复制到 <vault>/assets/<文档名>/，返回相对当前文档的路径。

use std::path::PathBuf;

use crate::util::{sanitize_name, unique_path};

/// 把图片复制到 <vault>/assets/<文档名>/，返回相对当前文档的相对路径。
#[tauri::command(rename_all = "camelCase")]
pub fn asset_import(vault: String, doc_path: String, src: String) -> Result<String, String> {
    let vault_path = PathBuf::from(&vault);
    let doc = PathBuf::from(&doc_path);
    let src_path = PathBuf::from(&src);

    if !src_path.is_file() {
        return Err("E_NOT_FOUND: 源文件不存在".into());
    }

    let stem = doc
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("assets");
    let assets_dir = vault_path.join("assets").join(sanitize_name(stem));
    std::fs::create_dir_all(&assets_dir).map_err(|e| format!("E_IO: {e}"))?;

    let file_name = src_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("image.png");
    let target = unique_path(&assets_dir, file_name);
    std::fs::copy(&src_path, &target).map_err(|e| format!("E_IO: {e}"))?;

    let doc_dir = doc.parent().unwrap_or(&vault_path);
    let rel_dir = doc_dir
        .strip_prefix(&vault_path)
        .map_err(|_| "E_INVALID_ARG: 文档不在知识库内".to_string())?;
    let ups = rel_dir.components().count();

    let mut rel = PathBuf::new();
    for _ in 0..ups {
        rel.push("..");
    }
    rel.push("assets");
    rel.push(sanitize_name(stem));
    rel.push(target.file_name().unwrap_or_default());

    Ok(rel.to_string_lossy().replace('\\', "/"))
}

/// 拖拽 / 粘贴进来的图片只有字节没有路径：直接写进知识库 assets，返回相对路径。
/// 默认的 `URL.createObjectURL` 会把 `blob:` 写进 Markdown —— 重启和换机器都会失效。
#[tauri::command(rename_all = "camelCase")]
pub fn asset_import_bytes(
    vault: String,
    doc_path: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("E_EMPTY: 空文件".into());
    }
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("E_TOO_LARGE: 图片超过 32 MB".into());
    }

    let vault_path = PathBuf::from(&vault);
    let doc = PathBuf::from(&doc_path);
    let stem = doc
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("assets");
    let assets_dir = vault_path.join("assets").join(sanitize_name(stem));
    std::fs::create_dir_all(&assets_dir).map_err(|e| format!("E_IO: {e}"))?;

    // 只取文件名，挡掉 ../ 之类的相对路径
    let safe_name = std::path::Path::new(&file_name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("image.png");
    let target = unique_path(&assets_dir, safe_name);
    std::fs::write(&target, bytes).map_err(|e| format!("E_IO: {e}"))?;

    let doc_dir = doc.parent().unwrap_or(&vault_path);
    let rel_dir = doc_dir
        .strip_prefix(&vault_path)
        .map_err(|_| "E_INVALID_ARG: 文档不在知识库内".to_string())?;
    let ups = rel_dir.components().count();

    let mut rel = PathBuf::new();
    for _ in 0..ups {
        rel.push("..");
    }
    rel.push("assets");
    rel.push(sanitize_name(stem));
    rel.push(target.file_name().unwrap_or_default());

    Ok(rel.to_string_lossy().replace('\\', "/"))
}
