# 方案：Git 同步（远程仓库当同步服务器）

> 状态：**仅方案与预览，未改代码**。对应预览：`docs/preview-git-sync.html`
> 形态：数据目录 `data\` 本身就是一个 git 仓库，远程仓库（私有 GitHub / Gitee / 自建 Gitea / NAS 裸仓库）充当「同步服务器」，多台设备的知识库自动保持一致。

---

## 1. 总体架构

```
设备 A（data\ 仓库）──commit/push──▶ 远程裸仓库（服务器）◀──pull/push── 设备 B（data\ 仓库）
        ▲                                  │
        └──────────pull --rebase───────────┘
```

- 远程只需一个**裸仓库**（`git init --bare`）或任意私有空仓库，不需要跑任何服务端软件；
- 每台设备的 `data\` 是完整仓库，离线可写，联网时 commit + push；
- `.trash/` 写进 `data\.gitignore` 不同步（回收站是本机的），`assets/` 正常同步。

## 2. 技术选型（关键决策）

| 方案 | 说明 | 取舍 |
|---|---|---|
| A. 调用系统 git（**推荐**） | `std::process::Command` 跑 `git`，要求本机装 git | 零新依赖；凭据走 Windows 凭据管理器 / SSH 配置，token 不落软件里；push/pull/rebase 全部免费获得 |
| B. 内嵌 libgit2（git2 crate） | 纯 Rust 绑定，不依赖外部 git | 需要处理 HTTPS token / SSH 密钥的凭据 UI，工作量大一个数量级；仅当要求「用户无需装 git」时再上 |
| C. gitoxide | 纯 Rust 新实现 | push 支持尚不成熟，排除 |

**结论：MVP 用方案 A。启动时检测 `git --version`，没有就提示「同步功能需要安装 Git」，其余功能不受影响。**

## 3. 后端新增（`src-tauri/src/lib.rs`）

```rust
/// 返回 { gitOk: bool, isRepo: bool, remote: String, branch: String,
///        ahead: u32, behind: u32, lastCommit: String }
#[tauri::command] fn sync_status(root: String) -> Result<SyncStatus, String>

/// 首次配置：init 仓库（若无）→ 写 .gitignore → 设置 user.name/email（仓库级）
/// → remote add → 首次 push（远端有内容则改为 pull --rebase 合并）
#[tauri::command(rename_all = "camelCase")]
fn sync_setup(root: String, remoteUrl: String, authorName: String, authorEmail: String) -> Result<(), String>

/// 同步一次：add -A → commit（有改动才提交，文案 "sync: <时间>"）
/// → pull --rebase --autostash → push；返回每步结果给前端展示
#[tauri::command(rename_all = "camelCase")]
fn sync_now(root: String) -> Result<SyncResult, String>

/// 仅修改远端地址 / 自动同步由前端 localStorage 持久化，不进后端
#[tauri::command(rename_all = "camelCase")]
fn sync_set_remote(root: String, remoteUrl: String) -> Result<(), String>
```

实现要点：
- 全部用 `Command::new("git").args(...)`，`current_dir(root)`，输出捕获后转成友好中文错误；
- `pull --rebase --autostash`：本地未提交改动自动暂存，避免同步被「先保存」卡住；
- 冲突检测：`pull` 退出码非 0 且 stderr 含 `CONFLICT` → 返回 `conflict` 状态，**不自动粗暴覆盖**；
- 凭据：不接触密码。HTTPS 首次 push 弹系统凭据管理器窗口；SSH 走用户已有 `~/.ssh` 配置。

## 4. 前端改动

| 文件 | 改动 |
|---|---|
| `src/api.ts` | `syncStatus / syncSetup / syncNow` 封装 |
| `src/store.ts` | 新增 `state.sync = { remote, ahead, behind, status }`；`syncNow()`；自动同步定时器（默认 15 分钟，可关，存 localStorage） |
| `TitleBar.vue` 或状态栏 | 「同步」按钮：图标 + 状态（已同步 ✓ / 待推送 ↑n / 待拉取 ↓n / 同步中… / 冲突 ⚠）；点击 = 立即同步 |
| 新增 `SyncSettings.vue`（弹窗） | 远程仓库地址、提交作者名/邮箱、自动同步开关与间隔、`sync_setup` 提交；入口放状态栏齿轮 |
| `StatusBar.vue` | 同步状态区 + 冲突红字提示「检测到冲突：本地与云端都改过同名文件，请导出备份后手动处理」 |

## 5. 同步策略

| 时机 | 动作 |
|---|---|
| 启动 | 静默 `pull --rebase --autostash`（配置了远端才执行） |
| 自动保存写盘后（debounce 30s） | 有改动才 `commit + push`，无网络则静默跳过（本地提交保留，下次补推） |
| 定时器（默认 15 分钟） | `pull + push`，仅双向都无新内容时静默 |
| 手动点「同步」 | 立即执行一轮并弹结果提示 |

## 6. 新设备恢复

新机器装好软件 → 打开同步设置 → 填同一个远程地址 → 检测到本地 data 为空而远端有内容 → 提示「从云端恢复知识库？」→ 执行 `clone` 到 data → 刷新目录树。反之老机器首次配置且远端为空 → 首推全部内容。

## 7. 边界与风险

| 风险 | 处理 |
|---|---|
| 两端同时改同一文件 | git 文本合并；同段冲突 → rebase 停下，状态栏红字提示，建议先「导出整库」备份；不做自动覆盖 |
| 未装 git / 无网络 | 功能整体优雅降级，编辑保存完全不受影响；离线提交本地保留 |
| 凭据 | 不存储任何账号密码：HTTPS 走系统凭据管理器，SSH 走 `~/.ssh`；remote URL 不回显明文 token（显示时打码） |
| `.trash` / `.git` 被扫描进目录树 | `.gitignore` 排除 `.trash/`；`lib.rs` 的 `SKIP_DIRS` 已含 `.git`，目录树不会显示 |
| 大文件 / 仓库膨胀 | markdown 纯文本，git 压缩高效；图片 assets 累积大后可后续加 LFS，MVP 不做 |
| push 泄露 | 方案前提是**私有**仓库；设置弹窗里明示「请使用私有仓库」 |

## 8. 实施步骤

1. 后端：`sync_status` → `sync_setup` → `sync_now`（含冲突识别）
2. 前端：api 封装 → SyncSettings 弹窗 → 状态栏同步按钮与状态
3. 自动同步定时器（写盘后 debounce + 定时 pull/push）
4. 新设备恢复流程 + README 说明（服务端只需 `git init --bare`）
