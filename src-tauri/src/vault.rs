//! 知识库目录扫描：产出前端目录树（目录在前、文件在后，各自按名称升序）。
//! 有置顶条目时，树顶插入虚拟「置顶」文件夹。

use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::pins::{load_pins, PINNED_FOLDER_PATH};
use crate::util::is_markdown;

const MAX_DEPTH: usize = 12;
const SKIP_DIRS: [&str; 5] = [".git", ".trash", "node_modules", "target", ".obsidian"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FsNode>>,
    /// 虚拟节点（如「置顶」文件夹）标记，前端据此禁用右键文件操作
    #[serde(skip_serializing_if = "Option::is_none")]
    is_virtual: Option<bool>,
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

/// 递归列出知识库中的 Markdown 文件与目录。
/// 有置顶条目时，树顶出现一个虚拟「置顶」文件夹，置顶项（任意层级）连同
/// 其子树都集中显示在该文件夹下（磁盘位置不动，仅显示层提升）。
#[tauri::command(rename_all = "camelCase")]
pub fn vault_scan(root: String) -> Result<Vec<FsNode>, String> {
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
        pinned.sort_by_key(|n| pins.iter().position(|p| *p == n.path).unwrap_or(usize::MAX));
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
