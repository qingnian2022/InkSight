import { computed, reactive } from "vue";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import {
  copyNode,
  createDir,
  createDoc,
  errorText,
  fileName,
  readDoc,
  renameNode,
  scanVault,
  stripExt,
  trashNode,
  writeDoc,
} from "./api";
import type { FsNode, OutlineItem, SaveState, Tab } from "./types";
import { namePromptState, openNamePrompt } from "./ui/namePrompt";

const LS_VAULT = "md-rust.vault";
const LS_THEME = "md-rust.theme";
const LS_ED_WIDTH = "md-rust.editor-width";
const LS_AUTOSAVE = "md-rust.autosave";

export type EditorMode = "source" | "rich";
export type EditorWidth = "narrow" | "standard" | "wide" | "full";

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
  tabs: [] as Tab[],
  activePath: "",
  theme: "light" as "light" | "dark",
  editorMode: "rich" as EditorMode,
  editorWidth: "standard" as EditorWidth,
  sourceMode: false,
  readonly: true,
  railCollapsed: false,
  outlineOpen: false,
  saveState: "saved" as SaveState,
  error: "",
  autoSave: true,
  charCount: 0,
  cursor: { line: 1, col: 1 },
  blockType: "paragraph",
  activeMarks: [] as string[],
});

export const activeTab = computed(
  () => state.tabs.find((t) => t.path === state.activePath) ?? null,
);

export const visibleRows = computed(() => {
  const rows: { node: FsNode; depth: number }[] = [];
  const walk = (nodes: FsNode[], depth: number) => {
    for (const node of nodes) {
      rows.push({ node, depth });
      if (node.isDir && state.expanded.has(node.path) && node.children?.length) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(state.tree, 0);
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
    // 默认只展开第一个目录，其余保持折叠
    const firstDir = state.tree.find((n) => n.isDir);
    if (firstDir) state.expanded.add(firstDir.path);
  } catch (err) {
    state.error = errorText(err);
  }
}

export async function pickVault() {
  const picked = await open({ directory: true, multiple: false, title: "选择知识库文件夹" });
  if (typeof picked !== "string") return;
  await useVault(picked);
}

export async function useVault(path: string) {
  await flush();
  state.tabs = [];
  state.activePath = "";
  state.root = path;
  state.expanded = new Set<string>();
  localStorage.setItem(LS_VAULT, path);
  await refresh();
}

export function toggleExpand(path: string) {
  if (state.expanded.has(path)) state.expanded.delete(path);
  else state.expanded.add(path);
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

/** 新建：只开一个内存中的「未命名」标签，磁盘上不创建文件；保存时才落盘。 */
export async function newDoc() {
  if (!state.root) {
    await pickVault();
    return;
  }
  const seq = state.tabs.filter((t) => isUntitledPath(t.path)).length + 1;
  const path = `${UNTITLED_PREFIX}${seq}`;
  state.tabs.push({
    path,
    name: seq > 1 ? `未命名 ${seq}` : "未命名",
    content: "",
    dirty: false,
  });
  state.activePath = path;
  state.readonly = state.editorMode === "source";
  state.saveState = "saved";
  state.charCount = 0;
  state.cursor = { line: 1, col: 1 };
}

export async function removeActiveDoc() {
  const tab = activeTab.value;
  if (!tab) return;
  const ok = await confirm(`把「${tab.name}」移到 .trash？可以在文件管理器里找回。`, {
    title: "移到回收站",
    kind: "warning",
    okLabel: "移到回收站",
    cancelLabel: "取消",
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
  if (!state.root) {
    await pickVault();
    return;
  }
  const name = await openNamePrompt({ title: "新建文档", initial: "未命名" });
  if (!name) return;
  try {
    const path = await createDoc(dir, name);
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
  if (!state.root) {
    await pickVault();
    return;
  }
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
  const ok = await confirm(`把「${label}」移到 .trash？可以在文件管理器里找回。`, {
    title: "删除",
    kind: "warning",
    okLabel: "移到回收站",
    cancelLabel: "取消",
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

  const storedWidth = localStorage.getItem(LS_ED_WIDTH) as EditorWidth | null;
  applyEditorWidth(
    storedWidth && EDITOR_WIDTHS.some((w) => w.key === storedWidth) ? storedWidth : "standard",
  );

  state.autoSave = localStorage.getItem(LS_AUTOSAVE) !== "0";

  const saved = localStorage.getItem(LS_VAULT);
  if (saved) {
    try {
      await useVault(saved);
    } catch {
      localStorage.removeItem(LS_VAULT);
      state.root = "";
    }
  }
}
