//! 文件 / 命名相关的共享工具：所有模块共用的纯函数。

use std::path::{Path, PathBuf};

/// 是否为 Markdown 文档（.md / .markdown / .mdx，大小写不敏感）。
pub(crate) fn is_markdown(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => matches!(ext.to_ascii_lowercase().as_str(), "md" | "markdown" | "mdx"),
        None => false,
    }
}

/// 清洗用户输入的名称：Windows 非法字符替换为 `_`，去掉首尾空白与点，
/// 空名回退「未命名」，最长 80 字符。
pub(crate) fn sanitize_name(raw: &str) -> String {
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

/// 补全 Markdown 扩展名。
pub(crate) fn ensure_md(name: &str) -> String {
    if name.to_ascii_lowercase().ends_with(".md") {
        name.to_string()
    } else {
        format!("{name}.md")
    }
}

/// 在目录下生成不冲突的路径：重名时追加 ` (2)`、` (3)` ……
pub(crate) fn unique_path(dir: &Path, file_name: &str) -> PathBuf {
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
