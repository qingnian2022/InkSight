# 方案：个人版内置知识库 + 导入 / 导出

> 状态：**已实施（2026-10-19）**。预览：`docs/preview-import-export.html`
> 目标形态：像语雀一样，笔记直接存在软件自己的数据目录里，用户不需要「打开某个文件夹」。

---

## 1. 现状与差距

| 现状 | 目标 |
|---|---|
| 知识库 = 用户手选的任意文件夹（`pickVault`，存 localStorage） | 内置固定数据目录 `<安装目录>/data/`，启动即用，无选择步骤 |
| 没有导入 / 导出 | 支持「导入 Markdown 文件 / 文件夹」「导出单篇 / 整库」 |
| 删除走 `<vault>/.trash/` | 不变，`.trash` 仍在 data 下 |
| 插入图片写入 `<vault>/assets/<文档名>/` | 不变，assets 仍在 data 下 |

---

## 2. 数据目录设计（关键决策）

```
<软件安装目录>/
└─ data/                 ← 唯一知识库，软件启动自动创建
   ├─ *.md / 子文件夹/    ← 用户文档
   ├─ assets/            ← 图片等附件（沿用现有 asset_import 逻辑）
   └─ .trash/            ← 回收站（导出时排除）
```

**⚠️ 必须注意：Windows 默认装到 `C:\Program Files`，该目录普通权限不可写。** 三种落地方式：

| 方案 | 说明 | 取舍 |
|---|---|---|
| A. 便携版（**推荐**） | 程序随 zip 解压到任意目录（如 `D:\soft\md-rust\`），数据就在 `exe 旁的 data/`，符合「安装目录下的 data」字面要求 | 完全符合需求；不做 MSI/NSIS 装系统目录 |
| B. 安装器可选目录 | 用 Tauri NSIS 安装器但默认装到 `D:\` 用户自选目录，允许写 data | 仍可能被用户装进 Program Files → 启动时检测不可写要报错降级 |
| C. 降级到 AppData | 若 `exe 目录/data` 创建失败（权限不足），回退到 `%APPDATA%/com.iife_.md-rust/data` | 最稳，但偏离字面需求，仅作兜底 |

**结论：主路径取 `<exe 目录>/data`（Tauri `app.path().resolve("data", BaseDirectory::Executable)`），创建失败时回退 AppData 并在状态栏提示实际路径。**

---

## 3. 后端改动（`src-tauri/src/lib.rs`）

新增 3 个 command，其余复用现有 `vault_scan / doc_read / doc_write / doc_create / node_copy / node_rename / node_trash`：

```rust
/// 解析并创建数据目录，返回 { path, fallback: bool }
#[tauri::command] fn data_dir(app: AppHandle) -> Result<DataDirInfo, String>

/// 批量导入：把若干 .md 文件 / 整个文件夹复制进 data 目录
/// 返回 { imported: usize, renamed: Vec<String>, skipped: Vec<String> }
#[tauri::command(rename_all = "camelCase")]
fn import_docs(dest_root: String, sources: Vec<String>) -> Result<ImportReport, String>

/// 导出整库为 zip（排除 .trash），或导出指定文件/文件夹到用户选定路径
#[tauri::command(rename_all = "camelCase")]
fn export_zip(source_root: String, dest_file: String, entries: Option<Vec<String>>) -> Result<ExportReport, String>
```

实现要点：
- `data_dir`：`std::fs::create_dir_all(exe_dir/data)`，失败则 `create_dir_all(app_data_dir/data)`，`fallback = true`。
- `import_docs`：
  - 复制而非移动（外部原文件不受影响）；
  - 文件夹导入**保留相对目录结构**（这样文内相对图片链接不失效）；
  - 重名走现成的 `unique_path`（自动 `xxx (2).md`），报告里列出改名结果；
  - 非md 文件跟随导入（图片等附件），但树扫描仍只显示 md（`.trash`、点开头的目录照旧跳过）；
  - 单文件大小沿用 20MB 上限提示。
- `export_zip`：引入 `zip` crate（一个依赖）；排除 `.trash`；整库导出 = data 全部内容；单篇/文件夹导出 = 选中条目在 zip 内保留其相对路径。
- `Cargo.toml` 新增：`zip = "2"`（默认 features 带 deflate 即可）。

## 4. 前端改动

| 文件 | 改动 |
|---|---|
| `src/api.ts` | 新增 `dataDir()` / `importDocs()` / `exportZip()` 封装 |
| `src/store.ts` | ① `init()` 改为 `useVault(await dataDir().path)`，删除 `LS_VAULT` 记忆逻辑；② `pickVault()` 改造为 `openDataFolder()`（用 opener 插件在资源管理器打开 data）；③ 新增 `importFiles()`、`exportAll()`、`exportNode(node)` |
| `SidebarTree.vue` | ① 顶部 `vault-switch` 改为固定标题「我的知识库」，点击 = 打开 data 文件夹；② 空状态文案改为「还没有文档，从导入开始」+ 两个按钮；③ rail-footer 显示 data 实际路径（超长省略，title 全显） |
| 右键菜单（App.vue + SidebarTree.vue） | **文件夹**：「导入 Markdown…（可多选）」→ 导入到该文件夹；「导出此文件夹」；**文件**：「导出此文档 (.md)」；**空白处**：「导出整库 (zip)」「刷新」 |
| `EditorPane.vue` | 空状态按钮 `pickVault` → `newDoc`（知识库始终存在，不再引导选目录） |
| `StatusBar.vue` | fallback 生效时显示「数据目录不可写，已改用 AppData」一次性提示 |

**删除的入口**：所有「选择知识库文件夹」弹窗与 localStorage 记忆（`LS_VAULT`）。

## 5. 导入交互

1. **右键目录树中的任意文件夹** → 「导入 Markdown…」→ 系统文件多选框（过滤 `*.md, *.markdown, *.mdx`，可多选）；
2. 选中文件**复制**进该文件夹（原文件不动）；
3. 完成后弹结果：`导入 12 篇，2 个重名已自动改名`，刷新目录树并展开该文件夹；
4. 右键 data 根目录（树空白处）即导入到知识库根目录。

## 6. 导出交互

- **单篇**：文件右键「导出此文档」→ 保存框 → 写出 `文档名.md`；
- **文件夹**：文件夹右键「导出此文件夹」→ 保存框 → zip（保留内部结构）；
- **整库**：树空白处右键「导出整库 (zip)」→ 保存框 `md-rust-backup-YYYYMMDD.zip` → 全量打包（排除 `.trash`）。

## 7. 边界与风险

| 风险 | 处理 |
|---|---|
| Program Files 不可写 | 方案 A 便携版 + 启动检测降级 AppData + 状态栏提示 |
| 导入同名文档 | `unique_path` 自动改名并在结果里提示 |
| 导入单文件时文内相对图片失效 | 结果弹窗提示「文中引用的本地图片不会随之导入，请把图片一并复制到 data/assets」 |
| 导入超大文件 / 非UTF-8 | 沿用 20MB 限制；`from_utf8_lossy` 现状不变 |
| zip 中文文件名 | zip crate 写入时统一 UTF-8 flag（Windows 资源管理器可正常解压） |
| 老用户已有 localStorage 知识库 | 首次启动检测到旧 `LS_VAULT` 时弹一次「是否把现有知识库复制到软件数据目录？」，确认后整目录复制 |

## 8. 实施步骤

1. Rust：`data_dir` + 启动解析与降级 → `import_docs` → `export_zip`（含 zip 依赖）
2. 前端：api 封装 → store 改造（去 pickVault）→ 侧栏/右键菜单 UI → 状态栏提示
3. 老数据一次性迁移弹窗
4. 联调：导入重复名 / 文件夹结构 / 整库导出还原验证
