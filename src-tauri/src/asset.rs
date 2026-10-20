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
