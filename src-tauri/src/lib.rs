use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_DOC_BYTES: u64 = 20 * 1024 * 1024;
const MAX_DEPTH: usize = 12;
const SKIP_DIRS: [&str; 5] = [".git", ".trash", "node_modules", "target", ".obsidian"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FsNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FsNode>>,
}

fn is_markdown(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => matches!(ext.to_ascii_lowercase().as_str(), "md" | "markdown" | "mdx"),
        None => false,
    }
}

fn scan(dir: &Path, depth: usize) -> Vec<FsNode> {
    if depth > MAX_DEPTH {
        return Vec::new();
    }
    let mut dirs: Vec<FsNode> = Vec::new();
    let mut files: Vec<FsNode> = Vec::new();

    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            dirs.push(FsNode {
                name,
                path: path.to_string_lossy().into_owned(),
                is_dir: true,
                children: Some(scan(&path, depth + 1)),
            });
        } else if is_markdown(&path) {
            files.push(FsNode {
                name,
                path: path.to_string_lossy().into_owned(),
                is_dir: false,
                children: None,
            });
        }
    }

    dirs.sort_by_key(|n| n.name.to_lowercase());
    files.sort_by_key(|n| n.name.to_lowercase());
    dirs.append(&mut files);
    dirs
}

fn sanitize_name(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        if ch.is_control() || r#"\/:*?"<>|"#.contains(ch) {
            out.push('_');
        } else {
            out.push(ch);
        }
    }
    let trimmed = out.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "未命名".to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}

fn ensure_md(name: &str) -> String {
    if name.to_ascii_lowercase().ends_with(".md") {
        name.to_string()
    } else {
        format!("{name}.md")
    }
}

fn unique_path(dir: &Path, file_name: &str) -> PathBuf {
    let mut candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("未命名");
    let ext = Path::new(file_name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("md");
    for i in 2..10_000 {
        candidate = dir.join(format!("{stem} ({i}).{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    candidate
}

/// 递归列出知识库中的 Markdown 文件与目录。目录在前，各自按名称升序。
#[tauri::command(rename_all = "camelCase")]
fn vault_scan(root: String) -> Result<Vec<FsNode>, String> {
    let path = PathBuf::from(&root);
    if !path.is_dir() {
        return Err("E_NOT_FOUND: 目录不存在".into());
    }
    Ok(scan(&path, 0))
}

#[tauri::command(rename_all = "camelCase")]
fn doc_read(path: String) -> Result<String, String> {
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
fn doc_write(path: String, content: String) -> Result<(), String> {
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

#[tauri::command(rename_all = "camelCase")]
fn doc_create(dir: String, name: String) -> Result<String, String> {
    let dir_path = PathBuf::from(&dir);
    if !dir_path.is_dir() {
        return Err("E_NOT_FOUND: 目录不存在".into());
    }
    let file_name = ensure_md(&sanitize_name(&name));
    let target = unique_path(&dir_path, &file_name);
    std::fs::write(&target, b"").map_err(|e| format!("E_IO: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command(rename_all = "camelCase")]
fn node_rename(path: String, new_name: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    let parent = src
        .parent()
        .ok_or_else(|| "E_INVALID_ARG: 路径没有父目录".to_string())?;
    let is_dir = src.is_dir();
    let cleaned = sanitize_name(&new_name);
    let file_name = if is_dir { cleaned } else { ensure_md(&cleaned) };
    if let Some(existing) = src.file_name().and_then(|s| s.to_str()) {
        if existing == file_name {
            return Ok(src.to_string_lossy().into_owned());
        }
    }
    let target = unique_path(parent, &file_name);
    std::fs::rename(&src, &target).map_err(|e| format!("E_IO: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

/// 移到 <root>/.trash/，不做硬删除。
#[tauri::command(rename_all = "camelCase")]
fn node_trash(root: String, path: String) -> Result<(), String> {
    let root_path = PathBuf::from(&root);
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err("E_NOT_FOUND: 目标不存在".into());
    }
    let trash = root_path.join(".trash");
    std::fs::create_dir_all(&trash).map_err(|e| format!("E_IO: {e}"))?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let name = src
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("untitled.md");
    let target = unique_path(&trash, &format!("{stamp}-{name}"));
    std::fs::rename(&src, &target).map_err(|e| format!("E_IO: {e}"))?;
    Ok(())
}

/// 把图片复制到 <vault>/assets/<文档名>/，返回相对当前文档的相对路径。
#[tauri::command(rename_all = "camelCase")]
fn asset_import(vault: String, doc_path: String, src: String) -> Result<String, String> {
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

#[tauri::command(rename_all = "camelCase")]
fn app_info() -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "name": "md-rust"
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            vault_scan,
            doc_read,
            doc_write,
            doc_create,
            node_rename,
            node_trash,
            asset_import,
            app_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
