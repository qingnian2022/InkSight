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

/// 图片引用修复：把笔记里指向本地文件的小图转成 data URL，大图保留原样。
/// 目的不是"优化"，而是让图片字节进入 .md 本身，git 同步后一定看得见。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageRepairReport {
    pub files_scanned: usize,
    pub images_found: usize,
    pub inlined: usize,
    pub skipped_large: usize,
    pub missing: usize,
    pub files_changed: usize,
}

fn mime_of(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

fn collect_markdown(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if matches!(name.as_str(), ".git" | ".trash" | "node_modules" | "target") {
                continue;
            }
            collect_markdown(&path, out);
        } else if name.to_lowercase().ends_with(".md") {
            out.push(path);
        }
    }
}

/// 扫描 `![alt](path)`；只处理本地文件，http/data/blob 原样跳过
fn inline_images(
    text: &str,
    base_dir: &std::path::Path,
    max_bytes: u64,
    stats: &mut ImageRepairReport,
) -> String {
    use base64::Engine;
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;

    while i < bytes.len() {
        if bytes[i] == b'!' && i + 1 < bytes.len() && bytes[i + 1] == b'[' {
            // 找 "](" 与配对的 ")"
            if let Some(close) = text[i..].find("](").map(|p| i + p) {
                if let Some(end) = text[close + 2..].find(')').map(|p| close + 2 + p) {
                    let raw = text[close + 2..end].trim();
                    let clean = raw.trim_start_matches('<').trim_end_matches('>');
                    if clean.is_empty()
                        || clean.starts_with("http://")
                        || clean.starts_with("https://")
                        || clean.starts_with("data:")
                        || clean.starts_with("blob:")
                    {
                        out.push_str(&text[i..=end]);
                        i = end + 1;
                        continue;
                    }

                    let candidate = std::path::Path::new(clean);
                    let abs = if candidate.is_absolute() {
                        candidate.to_path_buf()
                    } else {
                        base_dir.join(candidate)
                    };

                    stats.images_found += 1;
                    match std::fs::metadata(&abs) {
                        Ok(meta) if meta.is_file() => {
                            if meta.len() > max_bytes {
                                stats.skipped_large += 1;
                                out.push_str(&text[i..=end]);
                            } else if let Ok(data) = std::fs::read(&abs) {
                                let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
                                out.push_str(&format!(
                                    "![{}](data:{};base64,{})",
                                    &text[i + 2..close],
                                    mime_of(&abs),
                                    b64
                                ));
                                stats.inlined += 1;
                            } else {
                                stats.missing += 1;
                                out.push_str(&text[i..=end]);
                            }
                        }
                        _ => {
                            stats.missing += 1;
                            out.push_str(&text[i..=end]);
                        }
                    }
                    i = end + 1;
                    continue;
                }
            }
        }
        let ch = text[i..].chars().next().unwrap_or(' ');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

#[tauri::command]
pub fn repair_images(vault: String, max_bytes: Option<u64>) -> Result<ImageRepairReport, String> {
    let root = std::path::PathBuf::from(&vault);
    if !root.is_dir() {
        return Err("知识库目录不可用".into());
    }
    let limit = max_bytes.unwrap_or(512 * 1024);
    let mut files = Vec::new();
    collect_markdown(&root, &mut files);

    let mut stats = ImageRepairReport {
        files_scanned: files.len(),
        images_found: 0,
        inlined: 0,
        skipped_large: 0,
        missing: 0,
        files_changed: 0,
    };

    for file in files {
        let Ok(text) = std::fs::read_to_string(&file) else {
            continue;
        };
        let base = file.parent().map(|p| p.to_path_buf()).unwrap_or_default();
        let before = stats.inlined;
        let next = inline_images(&text, &base, limit, &mut stats);
        if stats.inlined > before && next != text {
            std::fs::write(&file, next).map_err(|e| format!("写入失败：{e}"))?;
            stats.files_changed += 1;
        }
    }

    Ok(stats)
}
