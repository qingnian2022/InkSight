<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { listen } from "@tauri-apps/api/event";
import ContextMenu from "./components/ContextMenu.vue";
import ActivityRail from "./components/ActivityRail.vue";
import FilesSidebar from "./components/FilesSidebar.vue";
import ModulePanel from "./components/ModulePanel.vue";
import ModuleStage from "./components/ModuleStage.vue";
import SftpBrowser from "./components/SftpBrowser.vue";
import SecretsPage from "./components/SecretsPage.vue";
import SettingsDialog from "./components/SettingsDialog.vue";
import { railVisible, visibleModules, featureOn } from "./settings";
import TerminalDock from "./components/TerminalDock.vue";
import TerminalSidebar from "./components/TerminalSidebar.vue";
import EditorPane from "./components/EditorPane.vue";
import EditorToolbar from "./components/EditorToolbar.vue";
import NamePrompt from "./components/NamePrompt.vue";
import ConfirmPrompt from "./components/ConfirmPrompt.vue";
import SyncConflictPrompt from "./components/SyncConflictPrompt.vue";
import AccountDialog from "./components/AccountDialog.vue";
import BootSplash from "./components/BootSplash.vue";
import Toast from "./components/Toast.vue";
import TemplatePicker from "./components/TemplatePicker.vue";
import ImageLightbox from "./components/ImageLightbox.vue";
import OutlineDrawer from "./components/OutlineDrawer.vue";
import SidebarTree from "./components/SidebarTree.vue";
import StatusBar from "./components/StatusBar.vue";
import TabBar from "./components/TabBar.vue";
import TitleBar from "./components/TitleBar.vue";
import { openContextMenu, type CtxItem } from "./ui/contextMenu";
import {
  beginRename as beginRemoteRename,
  downloadPath,
  list as loadRemote,
  loadProfiles,
  removeEntry,
  sftpStore,
  type SftpEntry,
} from "./sftp";
import {
  acceptSuggestion,
  beginRename,
  clearActive,
  closeAll,
  closeOthers,
  closeSession,
  ensureSession,
  newSession,
  openDock,
  pasteToActive,
  selectAllActive,
  selectionText,
  termStore,
  toggleDock,
} from "./terminal";
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
  isPinned,
  locateNode,
  newDoc,
  newDocFromTemplate,
  notify,
  parentDirOf,
  refresh,
  renamePath,
  saveAsTemplate,
  saveActive,
  setModule,
  state,
  togglePin,
  toggleReadonly,
  trashPath,
  WORK_MODULES,
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

/**
 * 终端的复制 / 粘贴快捷键必须在捕获阶段拦下来：
 * xterm 自己也监听 keydown，晚一步 Ctrl+Shift+C 会被当成 Ctrl+C（发 \x03 给 shell）。
 */
function onTermKeyCapture(event: KeyboardEvent) {
  const el = event.target as HTMLElement | null;
  if (!el?.closest(".term-dock")) return;

  // 右方向键：有回显就接受；没有则原样放行，普通右移不能坏
  if (
    event.key === "ArrowRight" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey
  ) {
    if (acceptSuggestion()) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }

  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
  const key = event.key.toLowerCase();
  if (key !== "c" && key !== "v") return;
  event.preventDefault();
  event.stopPropagation();
  if (key === "c") void copyTermSelection();
  else void pasteToTerminal();
}

function onKeydown(event: KeyboardEvent) {
  // 文件模块的功能键：和右键菜单里标出来的快捷键一致
  const remote = sftpStore.selected;
  if (state.module === "files" && remote) {
    if (event.key === "F2") {
      event.preventDefault();
      beginRemoteRename(remote.path);
      return;
    }
    if (event.key === "F5") {
      event.preventDefault();
      void downloadPath(remote.path);
      return;
    }
    if (event.key === "F8") {
      event.preventDefault();
      void removeEntry(remote);
      return;
    }
    if (event.key === "F9") {
      event.preventDefault();
      remoteProps(remote);
      return;
    }
  }

  const mod = event.ctrlKey || event.metaKey;
  if (!mod) return;
  const key = event.key.toLowerCase();

  // Ctrl+1–4：切活动栏模块（只换侧栏，会话不动）；被关掉的模块不响应
  const modIdx = ["1", "2", "3", "4", "5"].indexOf(key);
  if (modIdx >= 0 && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    const target = WORK_MODULES[modIdx].key;
    if (visibleModules.value.some((m) => m.key === target)) setModule(target);
    return;
  }

  // Ctrl+` 收起 / 展开终端 Dock；加 Shift 再开一个会话
  if (event.code === "Backquote") {
    // 终端功能没开放时，这个键完全不接管
    if (!featureOn("terminal")) return;
    event.preventDefault();
    if (event.shiftKey) {
      // 新会话一定要看得见：不在笔记页就先回去，然后连 Dock 一起打开
      if (state.module !== "notes") setModule("notes");
      void newSession(true);
    } else if (state.module === "terminal") {
      // 终端已经铺满主区时，「收起」等于离开这个模块
      setModule("notes");
    } else if (state.module !== "notes") {
      // 文件 / 搜索页脚下没有 Dock：这一下当成「回笔记并打开终端」
      setModule("notes");
      openDock();
    } else {
      toggleDock();
    }
    return;
  }

  // 焦点在终端里时，Ctrl+W / Ctrl+N 归 shell（PSReadLine 的删词、历史），不再抢作文档快捷键
  if ((event.target as HTMLElement | null)?.closest(".term-dock")) return;

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
  } else if (key === "e" && event.shiftKey) {
    // Ctrl+Shift+E 切换只读；Ctrl+E 留给「行内代码」（Milkdown 默认 Mod-e）
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
      { label: isPinned(path) ? "取消置顶" : "置顶", action: () => void togglePin(path) },
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
    { label: isPinned(path) ? "取消置顶" : "置顶", action: () => void togglePin(path) },
    { label: "在所在文件夹新建文档", action: () => void createDocIn(parentDirOf(path)) },
    { label: "存为模板", action: () => void saveAsTemplate(path) },
    { separator: true, label: "" },
    { label: `复制「${label}」副本`, action: () => void duplicateNode(locateNode(path)!) },
    { label: "重命名", shortcut: "F2", action: () => void renamePath(path, name) },
    { label: "复制路径", action: () => void copyNodePath(path) },
    { label: "导出此文档 (.md)", action: () => void exportNode(locateNode(path)!) },
    { separator: true, label: "" },
    { label: "删除", shortcut: "Del", action: () => void trashPath(path, name) },
  ];
}

/* ---------- 终端：右键与快捷键走终端语义 ---------- */

async function copyTermSelection() {
  const text = selectionText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // WebView 拒绝写剪贴板时静默，用户仍可用系统级复制
  }
}

async function pasteToTerminal() {
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return;
  }
  pasteToActive(text);
}

/**
 * 终端菜单：复制 / 粘贴 / 全选 / 清屏 + 会话动作。
 * 和文档菜单刻意不混 —— 「新建文档」「保存当前文档」在终端里没有意义。
 */
function termMenuItems(): CtxItem[] {
  const hasSelection = !!selectionText();
  return [
    {
      label: "复制",
      shortcut: "Ctrl+Shift+C",
      disabled: !hasSelection,
      action: () => void copyTermSelection(),
    },
    { label: "粘贴", shortcut: "Ctrl+Shift+V", action: () => void pasteToTerminal() },
    { separator: true, label: "" },
    { label: "全选", action: selectAllActive },
    { label: "清屏", shortcut: "Ctrl+L", action: clearActive },
    { separator: true, label: "" },
    { label: "新建终端", shortcut: "Ctrl+Shift+`", action: () => void newSession() },
    {
      label: "关闭当前终端",
      disabled: !termStore.activeId,
      action: () => void closeSession(termStore.activeId),
    },
  ];
}

/** 侧栏里的单个会话：重命名 / 关闭在这一行完成，不跳去应用动作 */
function termSessionMenuItems(id: number, title: string): CtxItem[] {
  const others = termStore.sessions.filter((s) => s.id !== id).length;
  return [
    { label: "重命名", shortcut: "F2", action: () => beginRename(id) },
    { label: "新建终端", shortcut: "Ctrl+Shift+`", action: () => void newSession() },
    { separator: true, label: "" },
    { label: `关闭「${title}」`, action: () => void closeSession(id) },
    { label: "关闭其他终端", disabled: others === 0, action: () => void closeOthers(id) },
  ];
}

/** 会话列表空白处：只留「新建」与「全部关闭」 */
function termListMenuItems(): CtxItem[] {
  return [
    { label: "新建终端", shortcut: "Ctrl+Shift+`", action: () => void newSession() },
    { separator: true, label: "" },
    {
      label: "关闭全部终端",
      disabled: termStore.sessions.length === 0,
      action: () => void closeAll(),
    },
  ];
}

/** 属性：能力范围内能给的信息都放一行 */
function remoteProps(entry: SftpEntry) {
  const size = entry.dir ? "目录" : `${entry.size} B`;
  const time = entry.modified ? new Date(entry.modified * 1000).toLocaleString("zh-CN") : "—";
  notify(`${entry.name} · ${size} · ${time}\n${entry.path}`);
}

/** 远端文件行的菜单：对齐 WinSCP 的常用项，只保留我们真做得到的动作 */
function sftpMenuItems(path: string, dir: boolean): CtxItem[] {
  const entry = sftpStore.entries.find((item) => item.path === path);
  return [
    {
      label: "打开",
      action: () => {
        if (dir) void loadRemote(path);
        else void downloadPath(path);
      },
    },
    { label: "下载", shortcut: "F5", action: () => void downloadPath(path) },
    { separator: true, label: "" },
    { label: "重命名", shortcut: "F2", action: () => beginRemoteRename(path) },
    {
      label: "删除",
      shortcut: "F8",
      action: () => {
        if (entry) void removeEntry(entry);
      },
    },
    { separator: true, label: "" },
    {
      label: "复制路径",
      action: () => {
        void navigator.clipboard.writeText(path).catch(() => {});
      },
    },
    {
      label: "属性",
      shortcut: "F9",
      action: () => {
        if (entry) remoteProps(entry);
      },
    },
  ];
}

/** 组装右键菜单：编辑器内是编辑动作，目录树是文件操作，其余是应用动作 */
function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  const target = e.target as HTMLElement;
  const editable = target.closest<HTMLElement>(
    ".ProseMirror, .cm-content, input, textarea, [contenteditable='true']",
  );
  // 0) 终端侧栏：会话行 / 列表空白处各有自己的动作，不落到应用菜单
  const termRow = target.closest<HTMLElement>(".term-row[data-term-id]");
  if (termRow) {
    const id = Number(termRow.dataset.termId);
    if (Number.isFinite(id) && id > 0) {
      const title = termStore.sessions.find((s) => s.id === id)?.title ?? "终端";
      openContextMenu(e.clientX, e.clientY, termSessionMenuItems(id, title));
      return;
    }
  }
  if (target.closest(".term-list")) {
    openContextMenu(e.clientX, e.clientY, termListMenuItems());
    return;
  }

  // 0.5) SFTP 远端文件行
  const sftpRow = target.closest<HTMLElement>(".sftp-row[data-entry-path]");
  if (sftpRow) {
    const path = sftpRow.dataset.entryPath ?? "";
    const dir = sftpRow.dataset.entryDir === "1";
    if (path) {
      openContextMenu(e.clientX, e.clientY, sftpMenuItems(path, dir));
      return;
    }
  }

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

  // 3) 终端：动作是终端语义，不是文档动作（xterm 内部有个隐藏 textarea，会被当成可编辑区）
  if (target.closest(".term-dock")) {
    openContextMenu(e.clientX, e.clientY, termMenuItems());
    return;
  }

  // 4) 编辑器内
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
      { label: "从模板新建…", action: () => void newDocFromTemplate() },
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

// 关掉某个功能时，如果正停在那页，退回笔记
watch(visibleModules, (list) => {
  if (!list.some((m) => m.key === state.module)) setModule("notes");
});

// 终端模块的主区就是终端本身：切进来时保证至少有一个会话在跑。
// 注意只补会话，不动 termStore.open —— 那是「笔记页下沿 Dock」的开关，
// 让它跟着模块走的话，从终端回到笔记会凭空多出一条终端。
watch(
  () => state.module,
  (module) => {
    if (module === "terminal") ensureSession();
  },
);

onMounted(() => {
  void init().then(() => {
    // 上次停在被关掉的模块上时退回笔记；还在终端模块则起一个会话
    if (!visibleModules.value.some((m) => m.key === state.module)) setModule("notes");
    else if (state.module === "terminal") ensureSession();
  });
  // 连接配置（含密码）存在数据目录，随应用启动读一次
  void loadProfiles();
  applySidebarWidth(sidebarWidth.value); // 恢复上次拖拽后的侧栏宽度
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("keydown", onTermKeyCapture, true);
  window.addEventListener("contextmenu", onContextMenu, true);

  // 托盘菜单「新建文档」：唤回窗口（Rust 侧已 show）并开新标签
  void listen("tray://new-doc", () => void newDoc()).then((un) => unlisteners.push(un));
  // 关闭缩到托盘：只提示一次，之后静默
  void listen("tray://minimized", () => {
    const flag = "md-rust.tray-hint";
    if (!localStorage.getItem(flag)) {
      localStorage.setItem(flag, "1");
      notify("Inksight 已最小化到托盘，点托盘图标唤回，右键托盘图标选择「退出」才会真正关闭。");
    }
  }).then((un) => unlisteners.push(un));
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("keydown", onTermKeyCapture, true);
  window.removeEventListener("contextmenu", onContextMenu, true);
  unlisteners.forEach((un) => un());
  document.body.classList.remove("resizing");
});
</script>

<template>
  <div class="app" :class="{ 'rail-collapsed': state.railCollapsed, 'no-rail': !railVisible, 'no-sidebar': state.module === 'secrets' }">
    <TitleBar />
    <div class="app-body">
      <ActivityRail />
      <SidebarTree v-if="state.module === 'notes'" />
      <TerminalSidebar v-else-if="state.module === 'terminal'" />
      <FilesSidebar v-else-if="state.module === 'files'" />
      <ModulePanel v-else-if="state.module === 'search'" :module="state.module" />
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
        <!-- 笔记区：切到别的模块时用 v-show 留活，避免 Milkdown 卸载后丢失撤销栈 -->
        <TabBar v-show="state.module === 'notes'" />
        <EditorToolbar v-if="state.editorMode === 'source' && state.module === 'notes'" />
        <div class="ed-row" v-show="state.module === 'notes'">
          <EditorPane />
          <OutlineDrawer />
        </div>
        <SftpBrowser v-if="state.module === 'files'" />
        <SecretsPage v-if="state.module === 'secrets'" />
        <ModuleStage v-if="state.module === 'search'" :module="state.module" />
        <TerminalDock :full="state.module === 'terminal'" :dock="state.module === 'notes'" />
      </div>
    </div>
    <StatusBar />
    <ContextMenu />
    <NamePrompt />
    <BootSplash v-if="state.boot.active" />
    <AccountDialog />
    <SyncConflictPrompt />
    <ConfirmPrompt />
    <Toast />
    <TemplatePicker />
    <ImageLightbox />
    <SettingsDialog />
  </div>
</template>
