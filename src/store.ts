import { computed, reactive } from "vue";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import {
  createDoc,
  errorText,
  fileName,
  readDoc,
  scanVault,
  stripExt,
  trashNode,
  writeDoc,
} from "./api";
import type { FsNode, OutlineItem, SaveState, Tab } from "./types";

const LS_VAULT = "md-rust.vault";
const LS_THEME = "md-rust.theme";

export type EditorMode = "source" | "rich";

export const state = reactive({
  root: "",
  tree: [] as FsNode[],
  expanded: new Set<string>(),
  tabs: [] as Tab[],
  activePath: "",
  theme: "light" as "light" | "dark",
  editorMode: "rich" as EditorMode,
  sourceMode: false,
  readonly: true,
  railCollapsed: false,
  outlineOpen: false,
  saveState: "saved" as SaveState,
  error: "",
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

export async function refresh() {
  if (!state.root) return;
  try {
    state.tree = await scanVault(state.root);
    for (const node of state.tree) {
      if (node.isDir) state.expanded.add(node.path);
    }
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

export async function newDoc() {
  if (!state.root) {
    await pickVault();
    return;
  }
  const dir = state.activePath ? dirOf(state.activePath) : state.root;
  try {
    const path = await createDoc(dir, "未命名");
    await refresh();
    const node = findNode(state.tree, path) ?? {
      name: fileName(path),
      path,
      isDir: false,
    };
    const parent = dirOf(path);
    if (parent !== state.root) state.expanded.add(parent);
    await openDoc(node);
  } catch (err) {
    state.error = errorText(err);
  }
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

function dirOf(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join("\\");
}

let saveTimer: number | undefined;

export function markDirty(path: string, content: string) {
  const tab = state.tabs.find((t) => t.path === path);
  if (!tab) return;
  if (tab.content === content) return;
  tab.content = content;
  tab.dirty = true;
  state.saveState = "dirty";
  state.charCount = content.replace(/\s+/g, "").length;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveTab(tab), 800);
}

export async function saveTab(tab: Tab) {
  if (!tab.dirty) return;
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

export async function saveActive() {
  window.clearTimeout(saveTimer);
  const tab = activeTab.value;
  if (tab) await saveTab(tab);
}

export async function flush() {
  window.clearTimeout(saveTimer);
  const tab = activeTab.value;
  if (tab?.dirty) await saveTab(tab);
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
