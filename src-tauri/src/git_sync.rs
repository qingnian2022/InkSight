//! 内置 git 同步：对应用数据目录（知识库）做 commit / pull --rebase / push。
//!
//! 走系统 git CLI 而不是 git2：
//! - 凭据交给成熟体系（Git Credential Manager 弹窗、SSH 密钥），无需自己实现认证
//! - rebase --autostash 等语义与命令行完全一致，行为可预测
//! - 不引入编译时间与体积开销；未安装 git 时功能自动降级
//!
//! 所有网络操作在 spawn_blocking 里执行，不阻塞 UI。

use serde::Serialize;
use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows 下隐藏 git 子进程的控制台窗口。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    /// 系统里能不能找到 git
    pub installed: bool,
    /// 知识库是否已 git init
    pub initialized: bool,
    /// 是否配置了 origin 远程
    pub has_remote: bool,
    /// origin 地址（未配置为空串）
    pub remote: String,
    /// 当前分支名（尚无提交时也能取到，如 main）
    pub branch: String,
    /// 有未提交改动（含未跟踪的新笔记）
    pub dirty: bool,
    /// 本地领先远程的提交数
    pub ahead: u32,
    /// 本地落后远程的提交数
    pub behind: u32,
    /// 处于合并冲突状态（rebase 中断、存在 unmerged 文件）
    pub conflicted: bool,
}

impl SyncStatus {
    fn unavailable() -> Self {
        Self {
            installed: false,
            initialized: false,
            has_remote: false,
            remote: String::new(),
            branch: String::new(),
            dirty: false,
            ahead: 0,
            behind: 0,
            conflicted: false,
        }
    }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub ok: bool,
    /// true 表示进入冲突状态，前端展示冲突操作
    pub conflicted: bool,
    /// 给面板 / 状态栏看的摘要
    pub message: String,
}

struct GitOut {
    ok: bool,
    stdout: String,
    stderr: String,
}

impl GitOut {
    /// 取一段适合展示的错误信息（git 的报错几乎都在 stderr）。
    fn err_text(&self) -> String {
        let mut text = self.stderr.trim().to_string();
        if text.is_empty() {
            text = self.stdout.trim().to_string();
        }
        if text.is_empty() {
            text = "git 命令执行失败".to_string();
        }
        // 多行报错只取最后几行关键信息，避免面板被刷爆
        let lines: Vec<&str> = text.lines().collect();
        let start = lines.len().saturating_sub(4);
        lines[start..].join("\n")
    }
}

fn git(vault: &Path, args: &[&str]) -> GitOut {
    let mut cmd = Command::new("git");
    cmd.current_dir(vault).args(args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    match cmd.output() {
        Ok(out) => GitOut {
            ok: out.status.success(),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        },
        Err(e) => GitOut {
            ok: false,
            stdout: String::new(),
            stderr: e.to_string(),
        },
    }
}

fn git_installed() -> bool {
    let mut cmd = Command::new("git");
    cmd.arg("--version");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.output().map(|o| o.status.success()).unwrap_or(false)
}

fn is_repo(vault: &Path) -> bool {
    vault.join(".git").exists()
}

/// 本地时间戳格式化为 UTC 文本（仅用于提交信息，不追求时区精确）。
fn utc_stamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (h, m, _s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Howard Hinnant 的 civil_from_days 算法：days since epoch → (y, m, d)
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mth = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mth <= 2 { y + 1 } else { y };
    format!("{y:04}-{mth:02}-{d:02} {h:02}:{m:02} UTC")
}

/// 确保本地提交身份可用；全局未配置时在仓库内落一份兜底身份。
fn ensure_identity(vault: &Path) {
    let name = git(vault, &["config", "user.name"]);
    if !name.ok || name.stdout.trim().is_empty() {
        git(vault, &["config", "--local", "user.name", "md-rust"]);
    }
    let email = git(vault, &["config", "user.email"]);
    if !email.ok || email.stdout.trim().is_empty() {
        git(vault, &["config", "--local", "user.email", "md-rust@local"]);
    }
}

/// 知识库默认忽略项：回收站目录不参与多机同步。
const GITIGNORE: &str = ".trash/\n";

fn ensure_gitignore(vault: &Path) {
    let path = vault.join(".gitignore");
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    if existing.lines().any(|l| l.trim() == ".trash/") {
        return;
    }
    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(GITIGNORE);
    let _ = std::fs::write(&path, next);
}

/// 当前分支名；尚无提交时 symbolic-ref 也能取到（如 main）。
fn current_branch(vault: &Path) -> String {
    let out = git(vault, &["symbolic-ref", "--short", "HEAD"]);
    if out.ok {
        out.stdout.trim().to_string()
    } else {
        "main".to_string()
    }
}

fn has_head(vault: &Path) -> bool {
    git(vault, &["rev-parse", "--verify", "HEAD"]).ok
}

/// 远程上目标分支是否已有内容（fetch 后可用 origin/<branch> 判断）。
fn remote_branch_exists(vault: &Path, branch: &str) -> bool {
    git(vault, &[
        "rev-parse",
        "--verify",
        &format!("origin/{branch}"),
    ])
    .ok
}

/// 把所有改动入暂存区，有实际暂存内容才提交；返回提交的文件数。
fn commit_all(vault: &Path) -> Result<usize, String> {
    git(vault, &["add", "-A"]);
    let staged = git(vault, &["diff", "--cached", "--name-only"]);
    if !staged.ok {
        return Err(format!("E_GIT: {}", staged.err_text()));
    }
    let count = staged.stdout.lines().filter(|l| !l.trim().is_empty()).count();
    if count > 0 {
        let msg = format!("sync: {}", utc_stamp());
        let commit = git(vault, &["commit", "-m", &msg]);
        if !commit.ok {
            return Err(format!("E_GIT: {}", commit.err_text()));
        }
    }
    Ok(count)
}

fn in_rebase(vault: &Path) -> bool {
    for kind in ["rebase-merge", "rebase-apply"] {
        let out = git(vault, &["rev-parse", "--git-path", kind]);
        if out.ok {
            let rel = out.stdout.trim();
            if !rel.is_empty() && vault.join(rel).exists() {
                return true;
            }
        }
    }
    false
}

fn abort_rebase(vault: &Path) {
    if in_rebase(vault) {
        git(vault, &["rebase", "--abort"]);
    }
}

/// 读取同步状态：只做本地查询，不访问网络，随时可调。
pub fn status_impl(vault: &str) -> Result<SyncStatus, String> {
    if !git_installed() {
        return Ok(SyncStatus::unavailable());
    }
    let dir = Path::new(vault);
    if !dir.is_dir() {
        return Err("E_NOT_FOUND: 知识库目录不存在".into());
    }
    if !is_repo(dir) {
        let mut st = SyncStatus::unavailable();
        st.installed = true;
        return Ok(st);
    }

    let remote = git(dir, &["remote", "get-url", "origin"]);
    let remote_url = if remote.ok {
        remote.stdout.trim().to_string()
    } else {
        String::new()
    };

    let dirty = !git(dir, &["status", "--porcelain"])
        .stdout
        .trim()
        .is_empty();
    let conflicted = !git(dir, &["diff", "--name-only", "--diff-filter=U"])
        .stdout
        .trim()
        .is_empty();

    let (ahead, behind) = {
        let out = git(dir, &["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
        if out.ok {
            let mut it = out.stdout.split_whitespace();
            let behind = it.next().and_then(|v| v.parse().ok()).unwrap_or(0);
            let ahead = it.next().and_then(|v| v.parse().ok()).unwrap_or(0);
            (ahead, behind)
        } else {
            (0, 0)
        }
    };

    Ok(SyncStatus {
        installed: true,
        initialized: true,
        has_remote: !remote_url.is_empty(),
        remote: remote_url,
        branch: current_branch(dir),
        dirty,
        ahead,
        behind,
        conflicted,
    })
}

/// 连接远程（首次引导 / 更换仓库地址）：
/// init（如需）→ 写 .gitignore → 配置提交身份 → remote → fetch →
/// 先提交本地全部内容，再与云端合流并推送。
pub fn setup_impl(vault: &str, remote: &str) -> Result<SyncResult, String> {
    if !git_installed() {
        return Err("E_NO_GIT: 未检测到 git，请先安装 git 并重启应用".into());
    }
    let dir = Path::new(vault);
    if !dir.is_dir() {
        return Err("E_NOT_FOUND: 知识库目录不存在".into());
    }

    if !is_repo(dir) {
        let init = git(dir, &["init", "-b", "main"]);
        if !init.ok {
            return Err(format!("E_GIT: {}", init.err_text()));
        }
    }
    ensure_gitignore(dir);
    ensure_identity(dir);

    if !remote.trim().is_empty() {
        let url = remote.trim();
        let existing = git(dir, &["remote", "get-url", "origin"]);
        let set = if existing.ok {
            git(dir, &["remote", "set-url", "origin", url])
        } else {
            git(dir, &["remote", "add", "origin", url])
        };
        if !set.ok {
            return Err(format!("E_GIT: {}", set.err_text()));
        }
        let fetch = git(dir, &["fetch", "origin"]);
        if !fetch.ok {
            return Err(format!(
                "E_REMOTE: 无法访问远程仓库，请检查地址与登录状态\n{}",
                fetch.err_text()
            ));
        }
    }

    let branch = current_branch(dir);
    let committed = commit_all(dir)?;

    if !has_head(dir) {
        // 本地还没有任何提交：云端有内容就直接导入（新机器接手旧库）
        if git(dir, &["remote", "get-url", "origin"]).ok && remote_branch_exists(dir, &branch) {
            let co = git(dir, &[
                "checkout",
                "-f",
                "-B",
                &branch,
                &format!("origin/{branch}"),
            ]);
            if !co.ok {
                return Err(format!("E_GIT: {}", co.err_text()));
            }
            return Ok(SyncResult {
                ok: true,
                conflicted: false,
                message: "已连接远程，云端全部笔记已拉取到本机".into(),
            });
        }
        // 本地与云端都空：只连了个空仓库
        return Ok(SyncResult {
            ok: true,
            conflicted: false,
            message: "已连接远程仓库（当前还没有内容）".into(),
        });
    }

    let mut pushed = false;
    if git(dir, &["remote", "get-url", "origin"]).ok {
        if remote_branch_exists(dir, &branch) {
            // 云端已有内容：rebase 本地提交上去（首台机器接手旧库时历史不相关）
            let pull = git(dir, &[
                "pull",
                "--rebase",
                "--autostash",
                "--allow-unrelated-histories",
                "origin",
                &branch,
            ]);
            if !pull.ok {
                let conflicted = !git(dir, &["diff", "--name-only", "--diff-filter=U"])
                    .stdout
                    .trim()
                    .is_empty();
                if conflicted {
                    return Ok(SyncResult {
                        ok: false,
                        conflicted: true,
                        message: "连接成功，但云端与本地内容有冲突，请在下方选择处理方式".into(),
                    });
                }
                return Err(format!("E_GIT: {}", pull.err_text()));
            }
        }
        let push = git(dir, &["push", "-u", "origin", &branch]);
        if !push.ok {
            return Err(format!("E_REMOTE: 推送失败\n{}", push.err_text()));
        }
        pushed = true;
    }

    let message = if pushed && committed > 0 {
        format!("已连接远程并推送 {committed} 个文件")
    } else if pushed {
        "已连接远程，本地与云端一致".into()
    } else {
        "已初始化本地仓库（未配置远程）".into()
    };
    Ok(SyncResult {
        ok: true,
        conflicted: false,
        message,
    })
}

/// 一次完整同步：提交本地改动 → 合入云端更新 → 推送。
pub fn sync_now_impl(vault: &str) -> Result<SyncResult, String> {
    if !git_installed() {
        return Err("E_NO_GIT: 未检测到 git，请先安装 git 并重启应用".into());
    }
    let dir = Path::new(vault);
    if !dir.is_dir() {
        return Err("E_NOT_FOUND: 知识库目录不存在".into());
    }
    if !is_repo(dir) {
        return Err("E_SETUP: 知识库尚未连接远程，请先在同步面板配置".into());
    }
    ensure_identity(dir);

    let has_remote = git(dir, &["remote", "get-url", "origin"]).ok;
    let committed = commit_all(dir)?;
    let branch = current_branch(dir);

    if !has_head(dir) {
        // 本地还没有提交：云端有内容就导入；两边都空则无事可做
        if has_remote {
            let fetch = git(dir, &["fetch", "origin"]);
            if !fetch.ok {
                return Err(format!("E_REMOTE: {}", fetch.err_text()));
            }
            if remote_branch_exists(dir, &branch) {
                let co = git(dir, &[
                    "checkout",
                    "-f",
                    "-B",
                    &branch,
                    &format!("origin/{branch}"),
                ]);
                if !co.ok {
                    return Err(format!("E_GIT: {}", co.err_text()));
                }
                return Ok(SyncResult {
                    ok: true,
                    conflicted: false,
                    message: "已从云端拉取全部笔记".into(),
                });
            }
            return Ok(SyncResult {
                ok: true,
                conflicted: false,
                message: "云端与本地都还没有内容".into(),
            });
        }
        return Ok(SyncResult {
            ok: true,
            conflicted: false,
            message: "本地无改动（未配置远程仓库）".into(),
        });
    }

    if !has_remote {
        return Ok(SyncResult {
            ok: true,
            conflicted: false,
            message: if committed > 0 {
                format!("已本地提交 {committed} 个文件（未配置远程仓库）")
            } else {
                "本地无改动，未配置远程仓库".into()
            },
        });
    }

    if has_head(dir) && remote_branch_exists(dir, &branch) {
        let pull = git(dir, &["pull", "--rebase", "--autostash", "origin", &branch]);
        if !pull.ok {
            let conflicted = !git(dir, &["diff", "--name-only", "--diff-filter=U"])
                .stdout
                .trim()
                .is_empty();
            if conflicted {
                return Ok(SyncResult {
                    ok: false,
                    conflicted: true,
                    message: "同步冲突：两台机器改动了同一篇文档".into(),
                });
            }
            return Err(format!("E_GIT: {}", pull.err_text()));
        }
    }

    let push = git(dir, &["push", "-u", "origin", &branch]);
    if !push.ok {
        return Err(format!("E_REMOTE: 推送失败\n{}", push.err_text()));
    }

    let message = match committed {
        0 => "已是最新".to_string(),
        n => format!("已同步：提交 {n} 个文件并推送"),
    };
    Ok(SyncResult {
        ok: true,
        conflicted: false,
        message,
    })
}

/// 冲突处理一：放弃本次同步，本地保持原样（稍后可重试）。
pub fn abort_impl(vault: &str) -> Result<(), String> {
    let dir = Path::new(vault);
    if !dir.is_dir() {
        return Err("E_NOT_FOUND: 知识库目录不存在".into());
    }
    abort_rebase(dir);
    Ok(())
}

/// 冲突处理二：放弃本地未同步的修改，强制与云端对齐（前端需二次确认）。
pub fn reset_remote_impl(vault: &str) -> Result<(), String> {
    let dir = Path::new(vault);
    if !dir.is_dir() {
        return Err("E_NOT_FOUND: 知识库目录不存在".into());
    }
    abort_rebase(dir);
    let fetch = git(dir, &["fetch", "origin"]);
    if !fetch.ok {
        return Err(format!("E_REMOTE: {}", fetch.err_text()));
    }
    let branch = current_branch(dir);
    let reset = git(dir, &["reset", "--hard", &format!("origin/{branch}")]);
    if !reset.ok {
        return Err(format!("E_GIT: {}", reset.err_text()));
    }
    Ok(())
}

// ---------------- Tauri 命令包装（async + spawn_blocking） ----------------

#[tauri::command(rename_all = "camelCase")]
pub async fn git_sync_status(vault: String) -> Result<SyncStatus, String> {
    tauri::async_runtime::spawn_blocking(move || status_impl(&vault))
        .await
        .map_err(|e| format!("E_TASK: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn git_sync_setup(vault: String, remote: String) -> Result<SyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || setup_impl(&vault, &remote))
        .await
        .map_err(|e| format!("E_TASK: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn git_sync_now(vault: String) -> Result<SyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || sync_now_impl(&vault))
        .await
        .map_err(|e| format!("E_TASK: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn git_sync_abort(vault: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || abort_impl(&vault))
        .await
        .map_err(|e| format!("E_TASK: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn git_sync_reset_remote(vault: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || reset_remote_impl(&vault))
        .await
        .map_err(|e| format!("E_TASK: {e}"))?
}

// ---------------- 单元测试：用本地 bare 仓库当远程，全程不碰网络 ----------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!(
                "md-rust-gitsync-{tag}-{}-{stamp}",
                std::process::id()
            ));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn path(&self) -> String {
            self.0.to_string_lossy().replace('\\', "/")
        }

        fn write(&self, name: &str, content: &str) {
            fs::write(self.0.join(name), content).unwrap();
        }

        fn read(&self, name: &str) -> String {
            fs::read_to_string(self.0.join(name)).unwrap_or_default()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn setup_sync_two_vaults_and_conflict_flow() {
        let remote = TempDir::new("remote");
        // 本地 bare 仓库当远程（等价于 Gitee 上的空仓库）
        let out = git(Path::new(&remote.0), &["init", "--bare", "-b", "main"]);
        assert!(out.ok, "git init --bare 失败: {}", out.err_text());

        // —— 机器 A：写入两篇笔记并连接远程（首推）——
        let a = TempDir::new("vault-a");
        a.write("a.md", "# A\n\n来自机器 A\n");
        a.write("b.md", "# B\n\n第二篇\n");
        let res = setup_impl(&a.path(), &remote.path()).expect("A setup 失败");
        assert!(res.ok, "A setup: {}", res.message);
        assert!(a.read(".gitignore").contains(".trash/"), "应写入 .gitignore");
        assert_eq!(
            git(Path::new(&remote.0), &["rev-parse", "--verify", "refs/heads/main"]).ok,
            true,
            "远程 main 应存在"
        );

        let st = status_impl(&a.path()).unwrap();
        assert!(st.initialized && st.has_remote && !st.dirty);
        assert_eq!(st.branch, "main");

        // —— A 再改一篇 → sync_now 推送 ——
        a.write("a.md", "# A\n\n机器 A 修改过\n");
        let res = sync_now_impl(&a.path()).expect("A sync 失败");
        assert!(res.ok, "A sync: {}", res.message);
        let st = status_impl(&a.path()).unwrap();
        assert_eq!(st.ahead, 0, "推送后 ahead 应为 0");
        assert_eq!(st.dirty, false);

        // —— 机器 B：本地另有一篇笔记，连接同一远程（不相关历史合流）——
        let b = TempDir::new("vault-b");
        b.write("c.md", "# C\n\n来自机器 B\n");
        let res = setup_impl(&b.path(), &remote.path()).expect("B setup 失败");
        assert!(res.ok, "B setup: {}", res.message);
        assert!(b.read("a.md").contains("机器 A 修改过"), "B 应拉到云端内容");
        assert!(b.read("c.md").contains("机器 B"), "B 本地内容应保留");

        // —— 冲突：A、B 各自改同一文件，B 同步时 rebase 冲突 ——
        a.write("a.md", "# A\n\nA 又改了这行\n");
        let res = sync_now_impl(&a.path()).unwrap();
        assert!(res.ok);

        b.write("a.md", "# A\n\nB 也改了这行\n");
        let res = sync_now_impl(&b.path()).expect("B sync 应返回冲突结果而非 Err");
        assert!(!res.ok && res.conflicted, "应为冲突状态: {:?}", res);

        let st = status_impl(&b.path()).unwrap();
        assert!(st.conflicted, "status 应报告冲突");

        // —— 处理一：放弃本次同步，本地回到干净状态 ——
        abort_impl(&b.path()).expect("abort 失败");
        let st = status_impl(&b.path()).unwrap();
        assert!(!st.conflicted, "abort 后不应再有冲突");
        assert!(b.read("a.md").contains("B 也改了这行"), "abort 保留本地版本");

        // —— 处理二：用云端覆盖本地 ——
        b.write("a.md", "# A\n\nB 又改了一次\n");
        let _ = commit_all(Path::new(&b.0));
        let res = sync_now_impl(&b.path()).expect("B sync 应再次冲突");
        assert!(res.conflicted);
        reset_remote_impl(&b.path()).expect("reset_remote 失败");
        assert!(
            b.read("a.md").contains("A 又改了这行"),
            "reset 后本地应为云端版本"
        );
        let st = status_impl(&b.path()).unwrap();
        assert!(!st.conflicted && !st.dirty);
    }

    #[test]
    fn setup_with_unreachable_remote_fails_cleanly() {
        let a = TempDir::new("vault-bad");
        a.write("x.md", "# X\n");
        let res = setup_impl(&a.path(), "https://.invalid/nonexistent.git");
        assert!(res.is_err(), "不可达远程应报错");
        let err = res.unwrap_err();
        assert!(err.starts_with("E_REMOTE"), "应为 E_REMOTE: {err}");
    }
}
