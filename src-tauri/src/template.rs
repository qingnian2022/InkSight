//! 模板：把已有文档存进知识库的 `.templates/` 目录，并列出可用模板。
//!
//! 注意：`vault_scan` 会跳过 `.` 开头的目录（`.templates` 不在目录树里），
//! 所以模板必须走这两个专用命令，否则前端永远读不到。

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::util::{ensure_md, sanitize_name, unique_path};

#[derive(Serialize)]
pub struct TemplateEntry {
    pub name: String,
    pub path: String,
    pub content: String,
}

fn templates_dir(root: &Path) -> PathBuf {
    root.join(".templates")
}

/// 列出 `.templates/*.md`，按名称排序；目录不存在返回空数组。
#[tauri::command(rename_all = "camelCase")]
pub fn template_list(root: String) -> Vec<TemplateEntry> {
    let dir = templates_dir(Path::new(&root));
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    let mut out: Vec<TemplateEntry> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || !crate::util::is_markdown(&path) {
            continue;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(_) => continue,
        };
        let name = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        out.push(TemplateEntry {
            name,
            path: path.to_string_lossy().into_owned(),
            content,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// 把一篇已有文档复制成模板（`.templates/<文档名>.md`，重名自动加序号）。
/// 返回新模板文件路径。
#[tauri::command(rename_all = "camelCase")]
pub fn template_save(root: String, path: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err("E_NOT_FOUND: 文档不存在".into());
    }
    let content = std::fs::read_to_string(&src).map_err(|e| format!("E_IO: {e}"))?;

    let dir = templates_dir(Path::new(&root));
    std::fs::create_dir_all(&dir).map_err(|e| format!("E_IO: {e}"))?;

    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let file_name = ensure_md(&sanitize_name(&stem));
    let target = unique_path(&dir, &file_name);
    std::fs::write(&target, content).map_err(|e| format!("E_IO: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

/// 删除一个自定义模板。
/// 只允许删 `.templates/` 下的 `.md`，防止越权删到知识库正文。
#[tauri::command(rename_all = "camelCase")]
pub fn template_delete(root: String, path: String) -> Result<(), String> {
    let dir = templates_dir(Path::new(&root));
    let dir = std::fs::canonicalize(&dir).map_err(|e| format!("E_IO: {e}"))?;
    let target = std::fs::canonicalize(&path).map_err(|e| format!("E_IO: {e}"))?;
    if !target.starts_with(&dir) || !crate::util::is_markdown(&target) {
        return Err("E_INVALID: 只能删除 .templates 下的模板".into());
    }
    std::fs::remove_file(&target).map_err(|e| format!("E_IO: {e}"))?;
    Ok(())
}
