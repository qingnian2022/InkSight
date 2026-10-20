//! 导入 / 导出：Markdown 文件与文件夹批量导入、整库或单节点 zip 导出。

use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::util::{is_markdown, sanitize_name, unique_path};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamedEntry {
    from: String,
    to: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    imported: u32,
    renamed: Vec<RenamedEntry>,
}

/// 把选中的 Markdown 文件 / 文件夹复制进目标目录，重名自动加序号（unique_path）。
/// 文件只收 Markdown；文件夹整棵复制（跳过点开头条目，.git 等），保留内部结构。
#[tauri::command(rename_all = "camelCase")]
pub fn import_docs(dest_dir: String, sources: Vec<String>) -> Result<ImportReport, String> {
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
            if !is_markdown(&src) {
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
pub struct ExportReport {
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
pub fn export_zip(
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
