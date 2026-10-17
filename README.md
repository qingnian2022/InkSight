# md-rust

本地优先的 Markdown 编辑器。选一个文件夹当知识库，直接读写磁盘上的 `.md` 文件——没有私有数据库，随时可以用 Git、其他编辑器或云盘接管。

当前为 **MVP（P0）**：左目录树 + 已打开文件标签 + 工具栏 + Typora 式即时渲染编辑区。

## 运行

```bash
npm install        # npm 安装（本机 pnpm 的符号链接异常，暂用 npm）
npm run tauri dev  # 桌面端
npm run dev        # 只跑前端（浏览器里没有 Tauri IPC，无法读写文件）
```

构建：`npm run tauri build`。

## 已实现

| 能力 | 说明 |
|---|---|
| 打开知识库 | 选择任意文件夹，递归扫描 `.md / .markdown / .mdx` |
| 目录树 | 展开折叠、目录优先排序、新建文档、刷新 |
| 标签行 | 多文档同时打开，未保存圆点，Ctrl+W 关闭 |
| Typora 式渲染 | 标题/引用/列表/分割线/行内强调；**光标所在行显示原始标记**，其余行隐藏 |
| 保存 | 800ms 防抖 + Ctrl+S；状态栏四态（已保存/未保存/保存中/失败） |
| 工具栏 | 撤销重做、标题循环、粗斜删码、链接、列表、引用、代码块、分割线 |
| 大纲 | 从标题实时提取，点击跳转到对应行 |
| 源码模式 | 工具栏一键关闭装饰，退回等宽源码（文档内容零改动） |
| 主题 | 浅色 / 深色，记忆在 localStorage |
| 删除 | 移到 `<vault>/.trash/`，不硬删 |

## 目录

```
src/
├─ App.vue                 外壳：左树 + 主区 + 状态栏
├─ store.ts                应用状态与动作（reactive，未上 Pinia）
├─ api.ts                  Tauri command 封装
├─ components/             树 / 标签 / 工具栏 / 编辑器 / 大纲 / 状态栏
├─ editor/
│  ├─ setup.ts             CodeMirror 6 配置与快捷键
│  ├─ typora.ts            即时渲染装饰（只作用于视图）
│  └─ commands.ts          格式命令
└─ styles/                 token 与布局
src-tauri/src/lib.rs       vault 扫描、读写、新建、重命名、回收站
```

## MVP 未覆盖（按设计文档排到 P1）

- 表格渲染、代码块语法高亮与围栏隐藏
- 图片粘贴落盘、`[[双链]]`、标签
- Ctrl+P 快速打开、全局全文搜索
- 外部文件改动监听与冲突提示
- 重命名入口、回收站还原 UI

## 文档

- `docs/PRD-01-md-rust-v0.1.md`（旧路线，待重写）
- `docs/FRAMEWORK-01-md-rust-v0.1.md`（旧路线，待重写）
- `docs/DESIGN-01-md-rust-v0.1.md`（当前界面契约）
- `design/prototype.html`（可交互界面稿）

## 注意

- `src-tauri/tauri.conf.json` 的 `csp` 仍为 `null`，正式版前需收紧。
- 本机 `pnpm install` 会生成空 `@scope` 目录导致 Vite 找不到依赖，暂用 `npm install`。
- 未提交 git（按当前约定）。
