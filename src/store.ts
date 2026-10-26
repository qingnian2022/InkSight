import { computed, reactive } from "vue";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  copyNode,
  createDir,
  createDoc,
  dataDir,
  errorText,
  exportZip,
  fileName,
  importDocs,
  openDataDir,
  pinList,
  pinSet,
  readDoc,
  renameNode,
  scanVault,
  stripExt,
  templateSave,
  trashNode,
  writeDoc,
} from "./api";
import type { FsNode, OutlineItem, SaveState, Tab } from "./types";
import type { ImportReport } from "./api";
import { namePromptState, openNamePrompt } from "./ui/namePrompt";
import { openConfirm } from "./ui/confirmPrompt";
import { applyTemplate, pickTemplate } from "./ui/templatePicker";
import {
  gitSyncAbort,
  gitSyncFromRemote,
  gitSyncNow,
  gitSyncResetRemote,
  gitSyncSetup,
  gitSyncStatus,
  gitSyncToRemote,
  type SyncStatus,
} from "./api";

const LS_THEME = "md-rust.theme";
const LS_ED_WIDTH = "md-rust.editor-width";
const LS_AUTOSAVE = "md-rust.autosave";
const LS_SYNC_AUTO = "md-rust.sync-auto";
const LS_SYNC_REMOTE = "md-rust.sync-remote";
const LS_ACCENT = "md-rust.accent";
const LS_SKIN = "md-rust.skin";

export const isTauri = "__TAURI_INTERNALS__" in window;

export type EditorMode = "source" | "rich";
export type EditorWidth = "narrow" | "standard" | "wide" | "full";
export type AccentTheme = "graphite" | "purple" | "blue" | "pink";
/** 界面皮肤：default = 现有石墨卡片风；macos = macOS 一体式窗口 */
export type Skin = "default" | "macos";

/** 主题色候选：石墨为默认基调，其余三种只换主色，整套 chrome 自动派生。 */
export const ACCENT_THEMES: {
  key: AccentTheme;
  label: string;
  /** 菜单里的色点（用浅色模式的主色示意） */
  swatch: string;
}[] = [
  { key: "graphite", label: "石墨", swatch: "#4a5050" },
  { key: "purple", label: "紫", swatch: "#7466cc" },
  { key: "blue", label: "蓝", swatch: "#4d71bb" },
  { key: "pink", label: "粉", swatch: "#a95a80" },
];

/** 列宽档位：按编辑区宽度的百分比设置，值写到 --ed-max，两套内核共用。 */
export const EDITOR_WIDTHS: {
  key: EditorWidth;
  label: string;
  value: string;
  hint: string;
}[] = [
  { key: "narrow", label: "窄", value: "60%", hint: "60%" },
  { key: "standard", label: "标准", value: "75%", hint: "75%" },
  { key: "wide", label: "宽", value: "90%", hint: "90%" },
  { key: "full", label: "全宽", value: "100%", hint: "铺满" },
];

export const state = reactive({
  root: "",
  tree: [] as FsNode[],
  expanded: new Set<string>(),
  pinned: [] as string[],
  tabs: [] as Tab[],
  activePath: "",
  theme: "light" as "light" | "dark",
  accent: "graphite" as AccentTheme,
  skin: "macos" as Skin,
  editorMode: "rich" as EditorMode,
  editorWidth: "standard" as EditorWidth,
  sourceMode: false,
  readonly: true,
  railCollapsed: false,
  outlineOpen: false,
  saveState: "saved" as SaveState,
  error: "",
  autoSave: true,
  notice: "",
  dataFallback: false,
  charCount: 0,
  cursor: { line: 1, col: 1 },
  blockType: "paragraph",
  activeMarks: [] as string[],
  /* git 同步（详情见下方「git 同步」区块） */
  syncStatus: null as SyncStatus | null,
  syncBusy: false,
  syncError: false,
  syncMessage: "",
  syncAt: 0,
  syncAuto: false,
});

export const activeTab = computed(
  () => state.tabs.find((t) => t.path === state.activePath) ?? null,
);

/**
 * 目录树可见行（含展开的子项）。
 * 置顶项在原位置保留一份，同时在上方「置顶」文件夹里有一份副本 ——
 * 同一路径可能出现两次，所以用 key 区分（副本加 `pinned:` 前缀）。
 */
export const visibleRows = computed(() => {
  const rows: { node: FsNode; depth: number; key: string; pinnedCopy: boolean }[] = [];
  const walk = (nodes: FsNode[], depth: number, inPinned: boolean) => {
    for (const node of nodes) {
      rows.push({
        node,
        depth,
        key: inPinned ? `pinned:${node.path}` : node.path,
        pinnedCopy: inPinned,
      });
      if (node.isDir && state.expanded.has(node.path) && node.children?.length) {
        walk(node.children, depth + 1, inPinned || node.isVirtual === true);
      }
    }
  };
  walk(state.tree, 0, false);
  return rows;
});

export const allDocs = computed(() => {
  const out: FsNode[] = [];
  const walk = (nodes: FsNode[]) => {
    for (const node of nodes) {
      if (node.isDir) walk(node.children ?? []);
      else out.push(node);
    }
  };
  walk(state.tree);
  return out;
});

export const outline = computed<OutlineItem[]>(() => {
  const tab = activeTab.value;
  if (!tab) return [];
  const items: OutlineItem[] = [];
  tab.content.split("\n").forEach((raw, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(raw);
    if (match) {
      items.push({ level: match[1].length, text: match[2], line: index + 1 });
    }
  });
  return items;
});

function findNode(nodes: FsNode[], path: string): FsNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.isDir) {
      const hit = findNode(node.children ?? [], path);
      if (hit) return hit;
    }
  }
  return null;
}

/** 按路径查找目录树节点（供右键菜单等外部使用）。 */
export function locateNode(path: string): FsNode | null {
  return findNode(state.tree, path);
}

export function setTheme(theme: "light" | "dark") {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(LS_THEME, theme);
}

export function toggleTheme() {
  setTheme(state.theme === "dark" ? "light" : "dark");
}

/** 切换主题色（只改主色 token，深浅两套派生值都在 tokens.css 里）。 */
export function setAccent(accent: AccentTheme) {
  state.accent = accent;
  document.documentElement.dataset.accent = accent;
  localStorage.setItem(LS_ACCENT, accent);
}

/** 切换界面皮肤；macOS 皮肤由 skin-macos.css 整套接管 token 与布局。 */
export function setSkin(skin: Skin) {
  state.skin = skin;
  document.documentElement.dataset.skin = skin;
  localStorage.setItem(LS_SKIN, skin);
}

/** 色板里「默认」色点：macOS 皮肤下默认强调色是系统蓝 */
export function accentSwatch(key: AccentTheme): string {
  const base = ACCENT_THEMES.find((t) => t.key === key);
  if (state.skin === "macos" && key === "graphite") return "#007aff";
  return base?.swatch ?? "#4a5050";
}

/**
 * 切换编辑内核。
 * source = CodeMirror 6 + 装饰器（保真：保存字节不变）
 * rich   = Milkdown Crepe 块级编辑（语雀式：全程不见标记，但保存会重排）
 */
export function setEditorMode(mode: EditorMode) {
  if (state.editorMode === mode) return;
  state.editorMode = mode;
  // 富文本模式本身就是所见即所得，不存在独立的阅读态
  if (mode === "rich") state.readonly = false;
}

/* ---------- 正文列宽 ---------- */

function applyEditorWidth(width: EditorWidth) {
  const meta = EDITOR_WIDTHS.find((w) => w.key === width) ?? EDITOR_WIDTHS[1];
  state.editorWidth = meta.key;
  document.documentElement.style.setProperty("--ed-max", meta.value);
}

/** 切换正文列宽；持久化到 localStorage，两套编辑内核共用一个变量。 */
export function setEditorWidth(width: EditorWidth) {
  applyEditorWidth(width);
  localStorage.setItem(LS_ED_WIDTH, width);
}

export async function refresh() {
  if (!state.root) return;
  try {
    state.tree = await scanVault(state.root);
    state.pinned = await pinList(state.root).catch(() => [] as string[]);
    // 默认只展开第一个目录，其余保持折叠；
    // 第一个目录是虚拟「置顶」文件夹时，尊重用户是否手动折叠过
    const firstDir = state.tree.find((n) => n.isDir);
    if (firstDir) {
      const manuallyCollapsed =
        firstDir.isVirtual && localStorage.getItem("md-rust.pinned-collapsed") === "1";
      if (!manuallyCollapsed) state.expanded.add(firstDir.path);
    }
  } catch (err) {
    state.error = errorText(err);
  }
  // 文件操作会改变 dirty 状态，顺手刷新同步状态（fire-and-forget）
  void refreshSyncStatus();
}

/** 是否已置顶。 */
export function isPinned(path: string): boolean {
  return state.pinned.includes(path);
}

/** 置顶 / 取消置顶：新置顶的排最前，整表写回数据目录的 .md-rust.json。 */
export async function togglePin(path: string) {
  const pins = state.pinned.filter((p) => p !== path);
  if (!isPinned(path)) pins.unshift(path);
  state.pinned = pins;
  try {
    await pinSet(state.root, pins);
    await refresh();
  } catch (err) {
    state.error = errorText(err);
  }
}

export async function useVault(path: string) {
  await flush();
  state.tabs = [];
  state.activePath = "";
  state.root = path;
  state.expanded = new Set<string>();
  await refresh();
}

/** 虚拟「置顶」文件夹的路径哨兵（与后端 PINNED_FOLDER_PATH 一致） */
export const PINNED_FOLDER_PATH = "::pinned::";

export function toggleExpand(path: string) {
  if (state.expanded.has(path)) {
    state.expanded.delete(path);
    // 用户手动折叠过置顶文件夹后，后续刷新不再自动展开
    if (path === PINNED_FOLDER_PATH) localStorage.setItem("md-rust.pinned-collapsed", "1");
  } else {
    state.expanded.add(path);
    if (path === PINNED_FOLDER_PATH) localStorage.removeItem("md-rust.pinned-collapsed");
  }
}

export async function openDoc(node: FsNode) {
  if (node.isDir) {
    toggleExpand(node.path);
    return;
  }
  const existing = state.tabs.find((t) => t.path === node.path);
  if (existing) {
    await activate(node.path);
    return;
  }
  await flush();
  try {
    const content = await readDoc(node.path);
    state.tabs.push({
      path: node.path,
      name: stripExt(node.name),
      content,
      dirty: false,
    });
    state.activePath = node.path;
    state.readonly = state.editorMode === "source";
    state.saveState = "saved";
    state.charCount = content.replace(/\s+/g, "").length;
  } catch (err) {
    state.error = errorText(err);
  }
}

export async function activate(path: string) {
  if (state.activePath === path) return;
  await flush();
  state.activePath = path;
  state.readonly = state.editorMode === "source";
  state.saveState = "saved";
  const tab = state.tabs.find((t) => t.path === path);
  if (tab) {
    state.charCount = tab.content.replace(/\s+/g, "").length;
    state.cursor = { line: 1, col: 1 };
  }
}

export async function closeTab(path: string) {
  const index = state.tabs.findIndex((t) => t.path === path);
  if (index < 0) return;
  if (state.activePath === path) {
    await flush();
  }
  const wasActive = state.activePath === path;
  state.tabs.splice(index, 1);
  if (wasActive) {
    const next = state.tabs[index] ?? state.tabs[index - 1] ?? null;
    state.activePath = next?.path ?? "";
    state.saveState = "saved";
    state.charCount = next ? next.content.replace(/\s+/g, "").length : 0;
    state.cursor = { line: 1, col: 1 };
  }
}

/** 未命名文档的哨兵路径前缀：冒号在 Windows 文件名里非法，不会和真实文件冲突。 */
const UNTITLED_PREFIX = "::untitled-";

export function isUntitledPath(path: string): boolean {
  return path.startsWith(UNTITLED_PREFIX);
}

/** 新建：走模板选择器（有默认模板则直接用），只开内存标签、保存时才落盘。 */
export async function newDoc(forcePicker = false) {
  if (!state.root) return;
  const tpl = await pickTemplate(state.root, forcePicker);
  if (!tpl) return;
  const seq = state.tabs.filter((t) => isUntitledPath(t.path)).length + 1;
  const path = `${UNTITLED_PREFIX}${seq}`;
  const name = seq > 1 ? `未命名 ${seq}` : "未命名";
  const content = applyTemplate(tpl.content, name);
  state.tabs.push({
    path,
    name,
    content,
    dirty: false,
  });
  state.activePath = path;
  state.readonly = state.editorMode === "source";
  state.saveState = "saved";
  state.charCount = content.replace(/\s+/g, "").length;
  state.cursor = { line: 1, col: 1 };
}

/** 把已有文档存为模板：复制进知识库 `.templates/`，随后出现在新建模板列表里。 */
export async function saveAsTemplate(path: string) {
  if (!state.root) return;
  try {
    const target = await templateSave(state.root, path);
    notify(`已存为模板：${stripExt(fileName(target))}`);
  } catch (err) {
    state.error = errorText(err);
  }
}

/** 显式打开模板选择器新建（右键菜单「从模板新建」）。 */
export async function newDocFromTemplate() {
  await newDoc(true);
}

export async function removeActiveDoc() {
  const tab = activeTab.value;
  if (!tab) return;
  const ok = await openConfirm({
    title: "移到回收站",
    message: `把「${tab.name}」移到 .trash？`,
    detail: "文件会保留在知识库的 .trash 目录，可在文件管理器里找回。",
    okText: "移到回收站",
    danger: true,
  });
  if (!ok) return;
  try {
    await trashNode(state.root, tab.path);
    state.tabs = state.tabs.filter((t) => t.path !== tab.path);
    state.activePath = state.tabs[0]?.path ?? "";
    await refresh();
  } catch (err) {
    state.error = errorText(err);
  }
}

/* ---------- 目录树右键操作 ---------- */

/** 在指定目录新建文档：弹窗输入名称，创建后直接打开。 */
export async function createDocIn(dir: string) {
  if (!state.root) return;
  const name = await openNamePrompt({ title: "新建文档", initial: "未命名" });
  if (!name) return;
  const tpl = await pickTemplate(state.root, true);
  if (!tpl) return;
  try {
    const path = await createDoc(dir, name);
    if (tpl.content) await writeDoc(path, applyTemplate(tpl.content, name));
    state.expanded.add(dir);
    await refresh();
    const node = findNode(state.tree, path) ?? { name: fileName(path), path, isDir: false };
    await openDoc(node);
  } catch (err) {
    state.error = errorText(err);
  }
}

/** 在指定目录新建子文件夹。 */
export async function createDirIn(dir: string) {
  if (!state.root) return;
  const name = await openNamePrompt({ title: "新建文件夹", initial: "新建文件夹" });
  if (!name) return;
  try {
    await createDir(dir, name);
    state.expanded.add(dir);
    await refresh();
  } catch (err) {
    state.error = errorText(err);
  }
}

/** 重命名文件或文件夹；已打开的标签和展开状态同步跟着改。 */
export async function renamePath(path: string, currentName: string) {
  const name = await openNamePrompt({
    title: "重命名",
    initial: currentName,
    confirmText: "重命名",
  });
  if (!name || name === currentName) return;
  try {
    const newPath = await renameNode(path, name);
    const tab = state.tabs.find((t) => t.path === path);
    if (tab) {
      tab.path = newPath;
      tab.name = stripExt(fileName(newPath));
      if (state.activePath === path) state.activePath = newPath;
    }
    if (state.expanded.has(path)) {
      state.expanded.delete(path);
      state.expanded.add(newPath);
    }
    await refresh();
  } catch (err) {
    state.error = errorText(err);
  }
}

/** 复制副本：同目录生成「xx 副本」，文件夹递归复制。 */
export async function duplicateNode(node: FsNode) {
  try {
    await copyNode(node.path);
    await refresh();
  } catch (err) {
    state.error = errorText(err);
  }
}

/** 复制完整路径到剪贴板；WebView 拒绝时退回 execCommand。 */
export async function copyNodePath(path: string) {
  try {
    await navigator.clipboard.writeText(path);
    return;
  } catch {
    /* 落到下面的兜底 */
  }
  const ta = document.createElement("textarea");
  ta.value = path;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

/** 删除文件 / 文件夹：移到 <vault>/.trash/；相关标签一并关闭。 */
export async function trashPath(path: string, label: string) {
  const ok = await openConfirm({
    title: "删除",
    message: `把「${label}」移到 .trash？`,
    detail: "文件会保留在知识库的 .trash 目录，可在文件管理器里找回。",
    okText: "移到回收站",
    danger: true,
  });
  if (!ok) return;
  try {
    await trashNode(state.root, path);
    // 命中该文件，或位于被删文件夹内的已打开标签，全部关闭
    state.tabs = state.tabs.filter(
      (t) => t.path !== path && !t.path.startsWith(`${path}\\`) && !t.path.startsWith(`${path}/`),
    );
    if (!state.tabs.some((t) => t.path === state.activePath)) {
      state.activePath = state.tabs[0]?.path ?? "";
      state.saveState = "saved";
      state.charCount = state.tabs[0]?.content.replace(/\s+/g, "").length ?? 0;
      state.cursor = { line: 1, col: 1 };
    }
    await refresh();
  } catch (err) {
    state.error = errorText(err);
  }
}

/* ---------- git 同步 ---------- */

let syncTimer: number | undefined;

/** 自动同步开关；持久化到 localStorage。 */
export function setSyncAuto(on: boolean) {
  state.syncAuto = on;
  localStorage.setItem(LS_SYNC_AUTO, on ? "1" : "0");
}

/** 读取本地同步状态（git status / 分支 / 领先落后），纯本地查询，不碰网络。 */
export async function refreshSyncStatus() {
  if (!isTauri || !state.root) return;
  try {
    state.syncStatus = await gitSyncStatus(state.root);
  } catch {
    /* git 暂不可用等场景静默，状态保持上次值 */
  }
}

/** 立即同步：提交本地改动 → 拉取 rebase → 推送。 */
export async function syncNow() {
  if (!isTauri || !state.root || state.syncBusy) return;
  state.syncBusy = true;
  state.syncError = false;
  try {
    const res = await gitSyncNow(state.root);
    state.syncMessage = res.message;
    state.syncError = !res.ok;
    if (res.ok) state.syncAt = Date.now();
    await refreshSyncStatus();
    if (res.ok) await refresh();
  } catch (err) {
    state.syncError = true;
    state.syncMessage = errorText(err);
  } finally {
    state.syncBusy = false;
  }
}

/** 从远程同步：拉取远程内容，冲突以远程为准。 */
export async function syncFromRemote() {
  if (!isTauri || !state.root || state.syncBusy) return;
  state.syncBusy = true;
  state.syncError = false;
  try {
    const res = await gitSyncFromRemote(state.root);
    state.syncMessage = res.message;
    state.syncError = !res.ok;
    if (res.ok) state.syncAt = Date.now();
    await refreshSyncStatus();
    if (res.ok) await refresh();
  } catch (err) {
    state.syncError = true;
    state.syncMessage = errorText(err);
  } finally {
    state.syncBusy = false;
  }
}

/** 同步本地到远程：推送本地内容，冲突以本地为准。 */
export async function syncToRemote() {
  if (!isTauri || !state.root || state.syncBusy) return;
  state.syncBusy = true;
  state.syncError = false;
  try {
    const res = await gitSyncToRemote(state.root);
    state.syncMessage = res.message;
    state.syncError = !res.ok;
    if (res.ok) state.syncAt = Date.now();
    await refreshSyncStatus();
    if (res.ok) await refresh();
  } catch (err) {
    state.syncError = true;
    state.syncMessage = errorText(err);
  } finally {
    state.syncBusy = false;
  }
}

/** 连接远程仓库（首次引导 / 更换地址）。成功后按约定默认开启自动同步。 */
export async function syncSetup(remote: string) {
  if (!isTauri || !state.root || state.syncBusy) return;
  const url = remote.trim();
  if (!url) return;
  state.syncBusy = true;
  state.syncError = false;
  try {
    const res = await gitSyncSetup(state.root, url);
    state.syncMessage = res.message;
    state.syncError = !res.ok;
    localStorage.setItem(LS_SYNC_REMOTE, url);
    if (res.ok) {
      state.syncAt = Date.now();
      setSyncAuto(true);
      await refreshSyncStatus();
      await refresh();
    }
  } catch (err) {
    state.syncError = true;
    state.syncMessage = errorText(err);
  } finally {
    state.syncBusy = false;
  }
}

/** 冲突处理一：放弃本次同步，本地保持原样。 */
export async function syncAbort() {
  if (!isTauri || !state.root) return;
  try {
    await gitSyncAbort(state.root);
    state.syncMessage = "已放弃本次同步，本地内容保持原样";
    state.syncError = false;
  } catch (err) {
    state.syncError = true;
    state.syncMessage = errorText(err);
  }
  await refreshSyncStatus();
}

/** 冲突处理二：放弃本地未同步修改，强制对齐云端（调用方需先确认）。 */
export async function syncResetRemote() {
  if (!isTauri || !state.root) return;
  try {
    await gitSyncResetRemote(state.root);
    state.syncMessage = "已放弃本地未同步的修改，与云端保持一致";
    state.syncError = false;
    state.syncAt = Date.now();
    await refresh();
  } catch (err) {
    state.syncError = true;
    state.syncMessage = errorText(err);
  }
  await refreshSyncStatus();
}

/** 自动同步：写盘成功后防抖 5 秒触发一次；冲突 / 忙碌时跳过。 */
function scheduleSync() {
  if (!state.syncAuto || state.syncBusy || !isTauri) return;
  const st = state.syncStatus;
  if (!st?.hasRemote || st.conflicted) return;
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => void syncNow(), 5000);
}

export function initSyncAuto() {
  state.syncAuto = localStorage.getItem(LS_SYNC_AUTO) === "1";
}

/** 面板输入框的初始远程地址：优先仓库里配置的，其次上次输入过的。 */
export function lastSyncRemote(): string {
  return state.syncStatus?.remote || localStorage.getItem(LS_SYNC_REMOTE) || "";
}

/* ---------- 内置数据目录 ---------- */

let noticeTimer: number | undefined;

/** 状态栏提示（导入 / 导出结果等），10 秒后自动消失。 */
export function notify(text: string) {
  state.notice = text;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    state.notice = "";
  }, 10000);
}

/** 在资源管理器中打开数据目录（侧栏标题点击触发）。 */
export async function openDataFolder() {
  if (!state.root) return;
  try {
    await openDataDir(state.root);
  } catch (err) {
    state.error = errorText(err);
  }
}

/** 右键目录导入：多选 Markdown 文件，复制进右键的那个文件夹。 */
export async function importInto(dir: string) {
  const picked = await open({
    multiple: true,
    title: "选择要导入的 Markdown 文件",
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }],
  });
  if (!picked) return;
  const sources = Array.isArray(picked) ? picked : [picked];
  try {
    const report = await importDocs(dir, sources);
    state.expanded.add(dir);
    await refresh();
    notify(`${describeReport(report)}。文中引用的本地图片不会随之导入，请把图片一并复制到 data/assets`);
  } catch (err) {
    state.error = errorText(err);
  }
}

/** 右键目录导入：多选文件夹，整棵复制（含图片等所有文件），保留内部结构。 */
export async function importFolderInto(dir: string) {
  const picked = await open({
    directory: true,
    multiple: true,
    title: "选择要导入的文件夹",
  });
  if (!picked) return;
  const sources = Array.isArray(picked) ? picked : [picked];
  try {
    const report = await importDocs(dir, sources);
    state.expanded.add(dir);
    await refresh();
    notify(`${describeReport(report)}。文件夹内所有文件（含图片）已按原结构复制。`);
  } catch (err) {
    state.error = errorText(err);
  }
}

function describeReport(report: ImportReport): string {
  const parts = [`导入 ${report.imported} 个文件`];
  if (report.renamed.length) {
    parts.push(
      `${report.renamed.length} 个重名已自动改名：${report.renamed
        .map((r) => `${r.from} → ${r.to}`)
        .join("、")}`,
    );
  }
  return parts.join("；");
}

function todayStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 导出整库为 zip（排除 .trash）。 */
export async function exportAll() {
  if (!state.root) return;
  const dest = await save({
    title: "导出整库 (zip)",
    defaultPath: `md-rust-backup-${todayStamp()}.zip`,
    filters: [{ name: "Zip 压缩包", extensions: ["zip"] }],
  });
  if (!dest) return;
  try {
    const report = await exportZip(state.root, dest, null);
    notify(
      `整库导出完成：${report.files} 个文件（${formatBytes(report.bytes)}），已保存到 ${dest}。`,
    );
  } catch (err) {
    state.error = errorText(err);
  }
}

/** 导出单个文档或文件夹：文档导出 .md，文件夹导出 zip。 */
export async function exportNode(node: FsNode) {
  const dest = await save({
    title: node.isDir ? "导出文件夹 (zip)" : "导出文档",
    defaultPath: node.isDir ? `${node.name}.zip` : node.name,
    filters: node.isDir ? [{ name: "Zip 压缩包", extensions: ["zip"] }] : undefined,
  });
  if (!dest) return;
  try {
    const report = await exportZip(state.root, dest, [node.path]);
    notify(
      `导出完成：${report.files} 个文件（${formatBytes(report.bytes)}），已保存到 ${dest}。`,
    );
  } catch (err) {
    state.error = errorText(err);
  }
}

function dirOf(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join("\\");
}

/** 路径的父目录（供「在所在文件夹新建」等菜单使用）。 */
export function parentDirOf(path: string): string {
  return dirOf(path);
}

let saveTimer: number | undefined;

/** 切换自动保存；关闭时取消已排队的定时写入。 */
export function setAutoSave(on: boolean) {
  state.autoSave = on;
  localStorage.setItem(LS_AUTOSAVE, on ? "1" : "0");
  if (!on) window.clearTimeout(saveTimer);
}

export function markDirty(path: string, content: string) {
  const tab = state.tabs.find((t) => t.path === path);
  if (!tab) return;
  if (tab.content === content) return;
  tab.content = content;
  tab.dirty = true;
  state.saveState = "dirty";
  state.charCount = content.replace(/\s+/g, "").length;
  // 自动保存只作用于已落盘的文档；未命名文档等手动保存
  if (!state.autoSave || isUntitledPath(path)) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveTab(tab), 800);
}

export async function saveTab(tab: Tab) {
  if (!tab.dirty || isUntitledPath(tab.path)) return;
  state.saveState = "saving";
  try {
    await writeDoc(tab.path, tab.content);
    tab.dirty = false;
    state.saveState = "saved";
    state.error = "";
    scheduleSync();
  } catch (err) {
    state.saveState = "error";
    state.error = errorText(err);
  }
}

/** 未命名文档的默认落盘位置：最近一个真实文档所在文件夹，否则知识库根目录。 */
function defaultNewDir(): string {
  for (let i = state.tabs.length - 1; i >= 0; i -= 1) {
    const t = state.tabs[i];
    if (t.path && !isUntitledPath(t.path)) return parentDirOf(t.path);
  }
  return state.root;
}

/** 未命名文档的落盘：弹窗确认名称与目录，确认后才创建文件并写入。 */
async function materializeTab(tab: Tab) {
  const dir = defaultNewDir();
  const name = await openNamePrompt({
    title: "保存新文档",
    initial: tab.name === "未命名" ? "未命名" : tab.name,
    confirmText: "保存",
    folder: dir,
  });
  if (!name) return;
  const targetDir = namePromptState.folder || dir;
  try {
    const path = await createDoc(targetDir, name);
    tab.path = path;
    tab.name = stripExt(fileName(path));
    const parent = parentDirOf(path);
    if (parent !== state.root) state.expanded.add(parent);
    await refresh();
    state.activePath = path;
    await saveTab(tab);
  } catch (err) {
    state.error = errorText(err);
  }
}

/** 手动保存（Ctrl+S / 状态栏 / 右键）：未命名文档在这里才真正创建文件。 */
export async function saveActive() {
  window.clearTimeout(saveTimer);
  const tab = activeTab.value;
  if (!tab) return;
  if (isUntitledPath(tab.path)) {
    if (tab.dirty || tab.content.trim()) await materializeTab(tab);
    return;
  }
  if (tab.dirty) await saveTab(tab);
}

/** 切换文档 / 关闭标签前的静默写盘；未命名文档跳过（不能替用户决定落盘位置）。 */
export async function flush() {
  window.clearTimeout(saveTimer);
  const tab = activeTab.value;
  if (tab?.dirty && !isUntitledPath(tab.path)) await saveTab(tab);
}

/** 阅读 / 编辑切换；切回阅读前先把改动写盘。富文本模式没有阅读态。 */
export async function toggleReadonly() {
  if (state.editorMode === "rich") return;
  if (!state.readonly) {
    await flush();
    state.readonly = true;
    return;
  }
  if (!state.activePath) return;
  state.readonly = false;
}

export function updateCursor(line: number, col: number) {
  state.cursor = { line, col };
}

export async function init() {
  const theme = localStorage.getItem(LS_THEME);
  setTheme(theme === "dark" ? "dark" : "light");

  const storedAccent = localStorage.getItem(LS_ACCENT) as AccentTheme | null;
  setAccent(
    storedAccent && ACCENT_THEMES.some((t) => t.key === storedAccent) ? storedAccent : "graphite",
  );

  setSkin(localStorage.getItem(LS_SKIN) === "default" ? "default" : "macos");

  const storedWidth = localStorage.getItem(LS_ED_WIDTH) as EditorWidth | null;
  applyEditorWidth(
    storedWidth && EDITOR_WIDTHS.some((w) => w.key === storedWidth) ? storedWidth : "standard",
  );

  state.autoSave = localStorage.getItem(LS_AUTOSAVE) !== "0";

  // 个人版：知识库固定为软件数据目录，启动即用，无需选择
  try {
    const info = await dataDir();
    state.dataFallback = info.fallback;
    await useVault(info.path);
    if (info.fallback) {
      notify(`安装目录不可用，数据目录已降级到 ${info.path}`);
    }
  } catch (err) {
    state.error = errorText(err);
  }

  // git 同步：恢复开关状态；开启自动同步时启动先静默拉一次，防止落后云端
  initSyncAuto();
  await refreshSyncStatus();
  if (state.syncAuto && state.syncStatus?.hasRemote && !state.syncStatus.conflicted) {
    void syncNow();
  }
}
