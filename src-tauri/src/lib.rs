mod git_sync;

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

const MAX_DOC_BYTES: u64 = 20 * 1024 * 1024;
const MAX_DEPTH: usize = 12;
const SKIP_DIRS: [&str; 5] = [".git", ".trash", "node_modules", "target", ".obsidian"];
const PINS_FILE: &str = ".md-rust.json";
/// 虚拟「置顶」文件夹的路径哨兵（:: 在 Windows 文件名里非法，不会与真实路径冲突）
const PINNED_FOLDER_PATH: &str = "::pinned::";

/// 置顶列表持久化在数据根目录的 .md-rust.json（点开头，目录树不扫描；随 git 同步）。
fn pins_file(root: &Path) -> PathBuf {
    root.join(PINS_FILE)
}

fn load_pins(root: &Path) -> Vec<String> {
    let raw = std::fs::read_to_string(pins_file(root)).unwrap_or_default();
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| {
            serde_json::from_value::<Vec<String>>(v.get("pinned")?.clone()).ok()
        })
        .unwrap_or_default()
}

fn save_pins(root: &Path, pins: &[String]) -> Result<(), String> {
    let json = serde_json::json!({ "pinned": pins });
    std::fs::write(
        pins_file(root),
        serde_json::to_string_pretty(&json).map_err(|e| format!("E_IO: {e}"))?,
    )
    .map_err(|e| format!("E_IO: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FsNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FsNode>>,
    /// 虚拟节点（如「置顶」文件夹）标记，前端据此禁用右键文件操作
    #[serde(skip_serializing_if = "Option::is_none")]
    is_virtual: Option<bool>,
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
                is_virtual: None,
            });
        } else if is_markdown(&path) {
            files.push(FsNode {
                name,
                path: path.to_string_lossy().into_owned(),
                is_dir: false,
                children: None,
                is_virtual: None,
            });
        }
    }

    dirs.sort_by_key(|n| n.name.to_lowercase());
    files.sort_by_key(|n| n.name.to_lowercase());
    dirs.append(&mut files);
    dirs
}

/// 递归把置顶条目从原位置摘出（连同其子树），按树序收进 hoisted。
fn drain_pinned(nodes: &mut Vec<FsNode>, pins: &[String], hoisted: &mut Vec<FsNode>) {
    for node in nodes.iter_mut() {
        if let Some(children) = node.children.as_mut() {
            drain_pinned(children, pins, hoisted);
        }
    }
    let mut i = 0;
    while i < nodes.len() {
        if pins.iter().any(|p| *p == nodes[i].path) {
            hoisted.push(nodes.remove(i));
        } else {
            i += 1;
        }
    }
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

/// 递归列出知识库中的 Markdown 文件与目录。
/// 有置顶条目时，树顶出现一个虚拟「置顶」文件夹，置顶项（任意层级）连同
/// 其子树都集中显示在该文件夹下（磁盘位置不动，仅显示层提升）。
#[tauri::command(rename_all = "camelCase")]
fn vault_scan(root: String) -> Result<Vec<FsNode>, String> {
    let path = PathBuf::from(&root);
    if !path.is_dir() {
        return Err("E_NOT_FOUND: 目录不存在".into());
    }
    let pins = load_pins(&path);
    let mut tree = scan(&path, 0);
    if !pins.is_empty() {
        let mut pinned: Vec<FsNode> = Vec::new();
        drain_pinned(&mut tree, &pins, &mut pinned);
        // drain 按树序收集，这里重排成用户置顶的顺序
        pinned.sort_by_key(|n| {
            pins.iter().position(|p| *p == n.path).unwrap_or(usize::MAX)
        });
        let folder = FsNode {
            name: "置顶".into(),
            path: PINNED_FOLDER_PATH.into(),
            is_dir: true,
            children: Some(pinned),
            is_virtual: Some(true),
        };
        tree.insert(0, folder);
    }
    Ok(tree)
}

/// 读取置顶列表（数据根 .md-rust.json）。
#[tauri::command(rename_all = "camelCase")]
fn pin_list(root: String) -> Result<Vec<String>, String> {
    Ok(load_pins(&PathBuf::from(&root)))
}

/// 保存置顶列表（整表覆盖，前端 togglePin 计算好后传入）。
#[tauri::command(rename_all = "camelCase")]
fn pin_set(root: String, paths: Vec<String>) -> Result<(), String> {
    save_pins(&PathBuf::from(&root), &paths)
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

/// 在指定目录下新建文件夹，重名自动加序号。
#[tauri::command(rename_all = "camelCase")]
fn dir_create(dir: String, name: String) -> Result<String, String> {
    let dir_path = PathBuf::from(&dir);
    if !dir_path.is_dir() {
        return Err("E_NOT_FOUND: 目录不存在".into());
    }
    let target = unique_path(&dir_path, &sanitize_name(&name));
    std::fs::create_dir_all(&target).map_err(|e| format!("E_IO: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

/// 复制文件或整个文件夹（递归），副本名自动带「副本」序号，返回新路径。
#[tauri::command(rename_all = "camelCase")]
fn node_copy(path: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err("E_NOT_FOUND: 目标不存在".into());
    }
    let parent = src
        .parent()
        .ok_or_else(|| "E_INVALID_ARG: 路径没有父目录".to_string())?;
    let name = src
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "E_INVALID_ARG: 路径没有文件名".to_string())?;
    let is_dir = src.is_dir();
    let stem = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(name);
    let ext = Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");

    let dup_name = |i: Option<u32>| -> String {
        let suffix = match i {
            None => " 副本".to_string(),
            Some(n) => format!(" 副本 ({n})"),
        };
        if is_dir || ext.is_empty() {
            format!("{stem}{suffix}")
        } else {
            format!("{stem}{suffix}.{ext}")
        }
    };

    let mut candidate = parent.join(dup_name(None));
    let mut i: u32 = 2;
    while candidate.exists() {
        candidate = parent.join(dup_name(Some(i)));
        i += 1;
    }

    if is_dir {
        copy_dir_all(&src, &candidate).map_err(|e| format!("E_IO: {e}"))?;
    } else {
        std::fs::copy(&src, &candidate).map_err(|e| format!("E_IO: {e}"))?;
    }
    Ok(candidate.to_string_lossy().into_owned())
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry.path(), &to)?;
        } else {
            std::fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
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

    // 置顶列表里的旧路径同步改写，保持置顶状态
    let src_str = src.to_string_lossy().into_owned();
    let target_str = target.to_string_lossy().into_owned();
    let mut pins = load_pins(parent);
    if let Some(pos) = pins.iter().position(|p| *p == src_str) {
        pins[pos] = target_str;
        let _ = save_pins(parent, &pins);
    }

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

    // 被删条目同步移出置顶列表
    let mut pins = load_pins(&root_path);
    if let Some(pos) = pins.iter().position(|p| *p == path) {
        pins.remove(pos);
        let _ = save_pins(&root_path, &pins);
    }
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
        "name": "见字如面"
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DataDirInfo {
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
fn data_dir(app: tauri::AppHandle) -> Result<DataDirInfo, String> {
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
fn open_data_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("E_OPENER: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RenamedEntry {
    from: String,
    to: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportReport {
    imported: u32,
    renamed: Vec<RenamedEntry>,
}

/// 把选中的 Markdown 文件 / 文件夹复制进目标目录，重名自动加序号（unique_path）。
/// 文件只收 Markdown；文件夹整棵复制（跳过点开头条目，.git 等），保留内部结构。
#[tauri::command(rename_all = "camelCase")]
fn import_docs(dest_dir: String, sources: Vec<String>) -> Result<ImportReport, String> {
    let dest = PathBuf::from(&dest_dir);
    if !dest.is_dir() {
        return Err("E_NOT_FOUND: 目标目录不存在".into());
    }
    let mut report = ImportReport {
        imported: 0,
        renamed: Vec::new(),
    };

    for source in sources {
        let src = PathBuf::from(&source);
        let name = match src.file_name().and_then(|s| s.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        if src.is_dir() {
            let target = unique_path(&dest, &sanitize_name(&name));
            copy_dir_filtered(&src, &target).map_err(|e| format!("E_IO: {e}"))?;
            let final_name = target
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if final_name != name {
                report.renamed.push(RenamedEntry {
                    from: name,
                    to: final_name,
                });
            }
            report.imported += count_files(&target);
        } else if src.is_file() {
            let is_md = src
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| matches!(e.to_ascii_lowercase().as_str(), "md" | "markdown" | "mdx"))
                .unwrap_or(false);
            if !is_md {
                continue;
            }
            let target = unique_path(&dest, &name);
            std::fs::copy(&src, &target).map_err(|e| format!("E_IO: {e}"))?;
            let final_name = target
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if final_name != name {
                report.renamed.push(RenamedEntry {
                    from: name,
                    to: final_name,
                });
            }
            report.imported += 1;
        }
    }
    Ok(report)
}

/// 递归复制目录，跳过点开头的文件 / 文件夹（.git、.obsidian 等）。
fn copy_dir_filtered(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_filtered(&entry.path(), &to)?;
        } else {
            std::fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
}

/// 统计目录下（递归、跳过点开头条目）的文件数。
fn count_files(dir: &Path) -> u32 {
    let mut n = 0;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            if path.is_dir() {
                n += count_files(&path);
            } else {
                n += 1;
            }
        }
    }
    n
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportReport {
    files: u32,
    bytes: u64,
}

fn zip_file(
    writer: &mut zip::ZipWriter<std::fs::File>,
    options: zip::write::SimpleFileOptions,
    path: &Path,
    rel: &str,
    report: &mut ExportReport,
) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("E_IO: {e}"))?;
    writer
        .start_file(rel.to_string(), options)
        .map_err(|e| format!("E_ZIP: {e}"))?;
    std::io::Write::write_all(writer, &bytes).map_err(|e| format!("E_ZIP: {e}"))?;
    report.files += 1;
    report.bytes += bytes.len() as u64;
    Ok(())
}

/// 递归打包目录；`rel` 为 zip 内相对路径（根目录为空串）。点开头的文件/目录跳过。
fn zip_dir(
    writer: &mut zip::ZipWriter<std::fs::File>,
    options: zip::write::SimpleFileOptions,
    dir: &Path,
    rel: &str,
    report: &mut ExportReport,
) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("E_IO: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let child_rel = if rel.is_empty() {
            name
        } else {
            format!("{rel}/{name}")
        };
        if path.is_dir() {
            writer
                .add_directory(child_rel.clone(), options)
                .map_err(|e| format!("E_ZIP: {e}"))?;
            zip_dir(writer, options, &path, &child_rel, report)?;
        } else {
            zip_file(writer, options, &path, &child_rel, report)?;
        }
    }
    Ok(())
}

/// 导出为 zip：entries 为空时打包整个 source_root（排除 .trash 等点开头目录）；
/// 否则只打包列出的文件 / 文件夹（zip 内以自身名字或相对结构呈现）。
#[tauri::command(rename_all = "camelCase")]
fn export_zip(
    source_root: String,
    dest_file: String,
    entries: Option<Vec<String>>,
) -> Result<ExportReport, String> {
    let root = PathBuf::from(&source_root);
    if !root.is_dir() {
        return Err("E_NOT_FOUND: 数据目录不存在".into());
    }
    let dest = PathBuf::from(&dest_file);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("E_IO: {e}"))?;
    }
    let file = std::fs::File::create(&dest).map_err(|e| format!("E_IO: {e}"))?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    let mut report = ExportReport { files: 0, bytes: 0 };

    let result = match entries {
        Some(list) if !list.is_empty() => {
            for entry in list {
                let path = PathBuf::from(&entry);
                let name = path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .ok_or_else(|| "E_INVALID_ARG: 路径没有文件名".to_string())?;
                if path.is_dir() {
                    writer
                        .add_directory(name.to_string(), options)
                        .map_err(|e| format!("E_ZIP: {e}"))?;
                    zip_dir(&mut writer, options, &path, name, &mut report)?;
                } else {
                    zip_file(&mut writer, options, &path, name, &mut report)?;
                }
            }
            Ok(())
        }
        _ => zip_dir(&mut writer, options, &root, "", &mut report),
    };
    result?;
    writer.finish().map_err(|e| format!("E_ZIP: {e}"))?;
    Ok(report)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例锁：托盘常驻后二次启动 → 唤回已有窗口，不再多开（必须是第一个插件）
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 点 ✕ 不退出：隐藏窗口、进程驻留托盘；真正退出走托盘菜单「退出」
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.emit("tray://minimized", ());
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let toggle = MenuItem::with_id(app, "toggle", "打开见字如面", true, None::<&str>)?;
            let new_doc = MenuItem::with_id(app, "new", "新建文档", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &new_doc, &quit])?;

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("见字如面 — 我的知识库")
                .menu(&menu)
                .show_menu_on_left_click(false) // 左键留给「切换窗口」
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => show_main(app),
                    "new" => {
                        show_main(app);
                        let _ = app.emit("tray://new-doc", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick { .. } = event {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault_scan,
            doc_read,
            doc_write,
            doc_create,
            dir_create,
            node_copy,
            node_rename,
            node_trash,
            asset_import,
            app_info,
            data_dir,
            open_data_dir,
            import_docs,
            export_zip,
            git_sync::git_sync_status,
            git_sync::git_sync_setup,
            git_sync::git_sync_now,
            git_sync::git_sync_from_remote,
            git_sync::git_sync_to_remote,
            git_sync::git_sync_abort,
            git_sync::git_sync_reset_remote,
            pin_list,
            pin_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 显示并聚焦主窗口（托盘菜单 / 双击图标 / 单实例二次启动共用）。
fn show_main(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}
