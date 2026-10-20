<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { listen } from "@tauri-apps/api/event";
import ContextMenu from "./components/ContextMenu.vue";
import EditorPane from "./components/EditorPane.vue";
import EditorToolbar from "./components/EditorToolbar.vue";
import NamePrompt from "./components/NamePrompt.vue";
import OutlineDrawer from "./components/OutlineDrawer.vue";
import SidebarTree from "./components/SidebarTree.vue";
import StatusBar from "./components/StatusBar.vue";
import TabBar from "./components/TabBar.vue";
import TitleBar from "./components/TitleBar.vue";
import { openContextMenu, type CtxItem } from "./ui/contextMenu";
import { getPmView } from "./editor/pmViewRef";
import type { TableCmd } from "./editor/tableCmds";
import {
  closeTab,
  createDirIn,
  createDocIn,
  copyNodePath,
  duplicateNode,
  exportAll,
  exportNode,
  importFolderInto,
  importInto,
  init,
  locateNode,
  newDoc,
  notify,
  parentDirOf,
  refresh,
  renamePath,
  saveActive,
  state,
  toggleReadonly,
  trashPath,
} from "./store";

/** 表格命令按需加载：prosemirror 体系不进首屏 */
function tableCmd(cmd: TableCmd) {
  void import("./editor/tableCmds").then((m) => m.runTableCmd(cmd));
}

/* ---------- 左侧目录栏手动拖拽调宽 ---------- */

const SIDEBAR_W_LS = "md-rust.sidebar-width";
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 560;

const sidebarWidth = ref(clampSidebarWidth(Number(localStorage.getItem(SIDEBAR_W_LS)) || 0));
let resizing = false;
let resizeStartX = 0;
let resizeStartW = 0;

function clampSidebarWidth(w: number) {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w));
}

function applySidebarWidth(w: number) {
  document.documentElement.style.setProperty("--rail-w", `${w}px`);
}

function startSidebarResize(e: PointerEvent) {
  e.preventDefault();
  resizing = true;
  resizeStartX = e.clientX;
  resizeStartW = sidebarWidth.value;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  document.body.classList.add("resizing");
}

function moveSidebarResize(e: PointerEvent) {
  if (!resizing) return;
  sidebarWidth.value = clampSidebarWidth(resizeStartW + (e.clientX - resizeStartX));
  applySidebarWidth(sidebarWidth.value);
}

function endSidebarResize(e: PointerEvent) {
  if (!resizing) return;
  resizing = false;
  document.body.classList.remove("resizing");
  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  localStorage.setItem(SIDEBAR_W_LS, String(sidebarWidth.value));
}

function onKeydown(event: KeyboardEvent) {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod) return;
  const key = event.key.toLowerCase();

  if (key === "n") {
    event.preventDefault();
    void newDoc();
  } else if (key === "s") {
    // 自动保存关闭后这是主保存通道；开着时也可以随时手动写盘
    event.preventDefault();
    void saveActive();
  } else if (key === "w" && state.activePath) {
    event.preventDefault();
    void closeTab(state.activePath);
  } else if (event.key === "\\") {
    event.preventDefault();
    state.railCollapsed = !state.railCollapsed;
  } else if (key === "e" && !event.shiftKey) {
    event.preventDefault();
    void toggleReadonly();
  } else if (key === "o" && event.shiftKey) {
    event.preventDefault();
    state.outlineOpen = !state.outlineOpen;
  }
}

/** 往编辑器派发合成快捷键（PM / CM 的按键映射都能接住） */
function keyOn(el: HTMLElement, key: string, shift = false) {
  el.focus();
  el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      ctrlKey: true,
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** 粘贴：读剪贴板后派发合成 paste 事件，让编辑器走自己的粘贴解析 */
async function pasteInto(el: HTMLElement) {
  el.focus();
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return; // WebView 拒绝读取时静默失败，用户仍可用 Ctrl+V
  }
  if (!text) return;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    document.execCommand("insertText", false, text);
    return;
  }
  const data = new DataTransfer();
  data.setData("text/plain", text);
  el.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
  );
}

/** 目录树节点的专属菜单：新增 / 复制 / 重命名 / 删除 */
function treeMenuItems(isDir: boolean, path: string, name: string): CtxItem[] {
  const label = name.replace(/\.mdx?$/i, "");
  if (isDir) {
    return [
      { label: "新建文档", action: () => void createDocIn(path) },
      { label: "新建子文件夹", action: () => void createDirIn(path) },
      { label: "导入 Markdown…（文件，可多选）", action: () => void importInto(path) },
      { label: "导入文件夹…（可多选）", action: () => void importFolderInto(path) },
      { separator: true, label: "" },
      { label: "复制文件夹", action: () => void duplicateNode(locateNode(path)!) },
      { label: "重命名", shortcut: "F2", action: () => void renamePath(path, name) },
      { label: "复制路径", action: () => void copyNodePath(path) },
      { label: "导出此文件夹 (zip)", action: () => void exportNode(locateNode(path)!) },
      { separator: true, label: "" },
      { label: "删除", shortcut: "Del", action: () => void trashPath(path, name) },
    ];
  }
  return [
    { label: "在所在文件夹新建文档", action: () => void createDocIn(parentDirOf(path)) },
    { separator: true, label: "" },
    { label: `复制「${label}」副本`, action: () => void duplicateNode(locateNode(path)!) },
    { label: "重命名", shortcut: "F2", action: () => void renamePath(path, name) },
    { label: "复制路径", action: () => void copyNodePath(path) },
    { label: "导出此文档 (.md)", action: () => void exportNode(locateNode(path)!) },
    { separator: true, label: "" },
    { label: "删除", shortcut: "Del", action: () => void trashPath(path, name) },
  ];
}

/** 组装右键菜单：编辑器内是编辑动作，目录树是文件操作，其余是应用动作 */
function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  const target = e.target as HTMLElement;
  const editable = target.closest<HTMLElement>(
    ".ProseMirror, .cm-content, input, textarea, [contenteditable='true']",
  );

  // 1) 目录树节点
  const treeRow = target.closest<HTMLElement>(".tree-row[data-path]");
  if (treeRow) {
    const path = treeRow.dataset.path ?? "";
    const node = locateNode(path);
    if (node) {
      openContextMenu(e.clientX, e.clientY, treeMenuItems(node.isDir, node.path, node.name));
      return;
    }
  }

  // 2) 目录树空白区域：根目录导入与新增
  if (target.closest(".tree")) {
    const items: CtxItem[] = [];
    if (state.root) {
      items.push(
        { label: "新建文档", shortcut: "Ctrl+N", action: () => void createDocIn(state.root) },
        { label: "新建文件夹", action: () => void createDirIn(state.root) },
        { label: "导入 Markdown…（到根目录）", action: () => void importInto(state.root) },
        { label: "导入文件夹…（到根目录）", action: () => void importFolderInto(state.root) },
        { separator: true, label: "" },
        { label: "导出整库 (zip)", action: () => void exportAll() },
        { label: "刷新目录", action: () => void refresh() },
      );
    }
    openContextMenu(e.clientX, e.clientY, items);
    return;
  }

  // 3) 编辑器内
  const items: CtxItem[] = [];
  if (editable) {
    const el = editable;
    items.push(
      { label: "撤销", shortcut: "Ctrl+Z", action: () => keyOn(el, "z") },
      { label: "重做", shortcut: "Ctrl+Y", action: () => keyOn(el, "y") },
      { separator: true, label: "" },
      {
        label: "剪切",
        shortcut: "Ctrl+X",
        action: () => {
          el.focus();
          document.execCommand("cut");
        },
      },
      {
        label: "复制",
        shortcut: "Ctrl+C",
        action: () => {
          el.focus();
          document.execCommand("copy");
        },
      },
      { label: "粘贴", shortcut: "Ctrl+V", action: () => void pasteInto(el) },
      { label: "全选", shortcut: "Ctrl+A", action: () => keyOn(el, "a") },
    );
    if (editable.classList.contains("ProseMirror")) {
      // 光标在表格内时，追加语雀式表格操作分组
      const inTable = target.closest(".milkdown-table-block");
      if (inTable && getPmView()) {
        items.push(
          { separator: true, label: "" },
          { label: "在上方插入行", action: () => tableCmd("rowBefore") },
          { label: "在下方插入行", action: () => tableCmd("rowAfter") },
          { label: "在左侧插入列", action: () => tableCmd("colBefore") },
          { label: "在右侧插入列", action: () => tableCmd("colAfter") },
          { separator: true, label: "" },
          { label: "删除行", action: () => tableCmd("delRow") },
          { label: "删除列", action: () => tableCmd("delCol") },
          { label: "删除表格", action: () => tableCmd("delTable") },
        );
      } else {
        items.push(
          { separator: true, label: "" },
          { label: "加粗", shortcut: "Ctrl+B", action: () => keyOn(el, "b") },
          { label: "斜体", shortcut: "Ctrl+I", action: () => keyOn(el, "i") },
        );
      }
    }
  } else {
    items.push(
      { label: "新建文档", shortcut: "Ctrl+N", action: () => void newDoc() },
      {
        label: "保存当前文档",
        shortcut: "Ctrl+S",
        disabled: !state.activePath,
        action: () => void saveActive(),
      },
      {
        label: "关闭标签",
        shortcut: "Ctrl+W",
        disabled: !state.activePath,
        action: () => void closeTab(state.activePath),
      },
      { separator: true, label: "" },
      {
        label: state.outlineOpen ? "收起大纲" : "打开大纲",
        shortcut: "Ctrl+Shift+O",
        action: () => {
          state.outlineOpen = !state.outlineOpen;
        },
      },
      {
        label: state.railCollapsed ? "展开目录" : "折叠目录",
        shortcut: "Ctrl+\\",
        action: () => {
          state.railCollapsed = !state.railCollapsed;
        },
      },
      {
        label: "刷新目录",
        disabled: !state.root,
        action: () => void refresh(),
      },
    );
  }

  openContextMenu(e.clientX, e.clientY, items);
}

const unlisteners: (() => void)[] = [];

onMounted(() => {
  void init();
  applySidebarWidth(sidebarWidth.value); // 恢复上次拖拽后的侧栏宽度
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("contextmenu", onContextMenu, true);

  // 托盘菜单「新建文档」：唤回窗口（Rust 侧已 show）并开新标签
  void listen("tray://new-doc", () => void newDoc()).then((un) => unlisteners.push(un));
  // 关闭缩到托盘：只提示一次，之后静默
  void listen("tray://minimized", () => {
    const flag = "md-rust.tray-hint";
    if (!localStorage.getItem(flag)) {
      localStorage.setItem(flag, "1");
      notify("md-rust 已最小化到托盘，点托盘图标唤回，右键托盘图标选择「退出」才会真正关闭。");
    }
  }).then((un) => unlisteners.push(un));
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("contextmenu", onContextMenu, true);
  unlisteners.forEach((un) => un());
  document.body.classList.remove("resizing");
});
</script>

<template>
  <div class="app" :class="{ 'rail-collapsed': state.railCollapsed }">
    <TitleBar />
    <div class="app-body">
      <SidebarTree />
      <div
        class="sidebar-resizer"
        :class="{ active: resizing }"
        title="拖拽调整目录栏宽度"
        @pointerdown="startSidebarResize"
        @pointermove="moveSidebarResize"
        @pointerup="endSidebarResize"
        @pointercancel="endSidebarResize"
      />
      <div class="main">
        <TabBar />
        <EditorToolbar v-if="state.editorMode === 'source'" />
        <div class="ed-row">
          <EditorPane />
          <OutlineDrawer />
        </div>
      </div>
    </div>
    <StatusBar />
    <ContextMenu />
    <NamePrompt />
  </div>
</template>
