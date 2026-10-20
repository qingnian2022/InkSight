//! 目录树节点操作：新建文档 / 新建文件夹 / 复制 / 重命名 / 移入回收站。
//! 重命名与删除会同步维护置顶列表，避免置顶项指向失效路径。

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::pins::{load_pins, save_pins};
use crate::util::{ensure_md, sanitize_name, unique_path};

#[tauri::command(rename_all = "camelCase")]
pub fn doc_create(dir: String, name: String) -> Result<String, String> {
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
pub fn dir_create(dir: String, name: String) -> Result<String, String> {
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
pub fn node_copy(path: String) -> Result<String, String> {
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
pub fn node_rename(path: String, new_name: String) -> Result<String, String> {
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
pub fn node_trash(root: String, path: String) -> Result<(), String> {
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
