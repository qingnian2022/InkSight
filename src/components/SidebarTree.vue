<script setup lang="ts">
import { computed, onBeforeUnmount, nextTick, ref } from "vue";
import {
  importInto,
  isPinned,
  movePath,
  newDoc,
  openDataFolder,
  openDoc,
  refresh,
  renamePath,
  state,
  toggleExpand,
  trashPath,
  visibleRows,
} from "../store";
import type { FsNode } from "../types";
import Icon from "./Icon.vue";

const treeEl = ref<HTMLElement | null>(null);
const focusIndex = ref(-1);

function onRow(node: FsNode) {
  // 刚结束拖拽的那次点击不当作「打开/展开」
  if (Date.now() - lastDragEnd < 250) return;
  if (node.isDir) toggleExpand(node.path);
  else void openDoc(node);
}

/* ---------- 拖拽移动（文件 / 文件夹 → 文件夹，或拖到空白处回根目录） ---------- */
const drag = ref<{ path: string; name: string; isDir: boolean } | null>(null);
const ghost = ref<{ x: number; y: number } | null>(null);
const drop = ref<{ highlight: string; targetDir: string; ok: boolean } | null>(null);
const dragIcon = computed(() => (drag.value?.isDir ? "folder" : "file"));

let armed: { path: string; name: string; isDir: boolean; el: HTMLElement } | null = null;
let startPt: { x: number; y: number } | null = null;
let lastDragEnd = 0;

function isUnder(path: string, dir: string) {
  return path === dir || path.startsWith(`${dir}\\`) || path.startsWith(`${dir}/`);
}

function parentOf(path: string) {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : "";
}

function findRowNode(path: string) {
  return visibleRows.value.find((r) => r.node.path === path)?.node ?? null;
}

function onDragStart(event: PointerEvent, row: { node: FsNode }) {
  if (event.button !== 0 || !state.root) return;
  if (row.node.isVirtual) return;
  const target = event.target as HTMLElement;
  if (target.closest(".twisty") || target.closest("button")) return;
  armed = {
    path: row.node.path,
    name: row.node.name,
    isDir: row.node.isDir,
    el: event.currentTarget as HTMLElement,
  };
  startPt = { x: event.clientX, y: event.clientY };
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd);
}

function onDragMove(event: PointerEvent) {
  if (!armed || !startPt) return;
  if (!drag.value) {
    if (Math.hypot(event.clientX - startPt.x, event.clientY - startPt.y) < 5) return;
    drag.value = { path: armed.path, name: armed.name, isDir: armed.isDir };
    armed.el.classList.add("dragging");
    treeEl.value?.classList.add("dragging-active");
  }
  event.preventDefault();
  ghost.value = { x: event.clientX, y: event.clientY };
  updateDrop(event.clientX, event.clientY);
}

function updateDrop(x: number, y: number) {
  if (!drag.value) return;
  const under = document.elementFromPoint(x, y);
  const rowEl = under?.closest<HTMLElement>(".tree-row");
  if (!rowEl) {
    drop.value = under?.closest(".tree") ? { highlight: "", targetDir: state.root, ok: true } : null;
    return;
  }
  if (rowEl.classList.contains("pin-head")) {
    drop.value = { highlight: "", targetDir: "", ok: false };
    return;
  }
  const path = rowEl.dataset.path;
  if (!path) {
    drop.value = null;
    return;
  }
  const node = findRowNode(path);
  const targetDir = node?.isDir ? node.path : parentOf(path);
  if (!targetDir) {
    drop.value = null;
    return;
  }
  const ok = !isUnder(targetDir, drag.value.path);
  drop.value = { highlight: path, targetDir, ok };
}

async function onDragEnd() {
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", onDragEnd);
  const moved = drag.value;
  const target = drop.value;

  armed?.el.classList.remove("dragging");
  treeEl.value?.classList.remove("dragging-active");
  armed = null;
  startPt = null;
  drag.value = null;
  ghost.value = null;
  drop.value = null;

  if (!moved || !target) return;
  lastDragEnd = Date.now();
  if (!target.ok || !target.targetDir) return;
  await movePath(moved.path, target.targetDir);
}

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", onDragEnd);
});

/** 分隔线挂在「置顶子树最后一行」之后：展开时是最后一个子项，折叠时是「置顶」行本身。 */
/** 键盘导航：↑↓ 移动、→← 展开收起、Enter 打开、F2 重命名、Delete 删除 */
async function onTreeKey(event: KeyboardEvent) {
  const list = rowsWithSep.value;
  if (!list.length) return;
  if (focusIndex.value < 0) focusIndex.value = 0;
  const row = list[focusIndex.value];

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      focusIndex.value = Math.min(list.length - 1, focusIndex.value + 1);
      break;
    case "ArrowUp":
      event.preventDefault();
      focusIndex.value = Math.max(0, focusIndex.value - 1);
      break;
    case "Home":
      event.preventDefault();
      focusIndex.value = 0;
      break;
    case "End":
      event.preventDefault();
      focusIndex.value = list.length - 1;
      break;
    case "ArrowRight":
      if (row.node.isDir && !state.expanded.has(row.node.path)) {
        event.preventDefault();
        toggleExpand(row.node.path);
      }
      break;
    case "ArrowLeft":
      if (row.node.isDir && state.expanded.has(row.node.path)) {
        event.preventDefault();
        toggleExpand(row.node.path);
      }
      break;
    case "Enter":
      event.preventDefault();
      onRow(row.node);
      break;
    case "F2":
      if (!row.node.isVirtual) {
        event.preventDefault();
        await renamePath(row.node.path, row.node.name);
      }
      break;
    case "Delete":
      if (!row.node.isVirtual) {
        event.preventDefault();
        await trashPath(row.node.path, row.node.name);
      }
      break;
    default:
      return;
  }

  await nextTick();
  const el = treeEl.value?.querySelector<HTMLElement>(`[data-idx="${focusIndex.value}"]`);
  el?.scrollIntoView({ block: "nearest" });
}

const rowsWithSep = computed(() => {
  const list = visibleRows.value;
  const rows = list.map((row) => ({ ...row, sepAfter: false }));
  const vIdx = rows.findIndex((r) => r.node.isVirtual);
  if (vIdx >= 0) {
    let j = vIdx + 1;
    while (j < rows.length && rows[j].depth !== 0) j += 1;
    rows[j - 1].sepAfter = true;
  }
  return rows;
});
</script>

<template>
  <aside class="sidebar" aria-label="知识库目录">
    <div class="rail-head">
      <button
        class="vault-switch"
        title="我的知识库（内置数据目录），点击在资源管理器中打开"
        @click="openDataFolder"
      >
        <Icon name="folder" :size="15" />
        <span>我的知识库</span>
        <Icon name="chevron" :size="12" class="chev" />
      </button>
      <span class="rail-head-spacer" />
      <button class="tool-btn" title="新建文档 Ctrl+N" aria-label="新建文档" @click="() => newDoc()">
        <Icon name="plus" :size="15" />
      </button>
      <button class="tool-btn" title="刷新目录" aria-label="刷新目录" @click="refresh">
        <Icon name="refresh" :size="15" />
      </button>
      <button
        class="tool-btn"
        :aria-pressed="state.railCollapsed"
        title="折叠目录树 Ctrl+\"
        aria-label="折叠目录树"
        @click="state.railCollapsed = !state.railCollapsed"
      >
        <Icon name="panel" :size="15" />
      </button>
    </div>

    <div
      ref="treeEl"
      class="tree"
      role="tree"
      tabindex="0"
      :aria-activedescendant="focusIndex >= 0 ? `tree-row-${focusIndex}` : undefined"
      @keydown="onTreeKey"
    >
      <TransitionGroup name="tree">
        <div
          v-for="(row, idx) in rowsWithSep"
          :key="row.key"
          :id="`tree-row-${idx}`"
          :data-idx="idx"
          class="tree-row"
          role="treeitem"
          :data-path="row.node.isVirtual ? undefined : row.node.path"
          :aria-expanded="row.node.isDir ? state.expanded.has(row.node.path) : undefined"
          :class="{
            dragging: drag?.path === row.node.path,
            'drop-ok': !!drop?.ok && drop.highlight === row.node.path,
            'drop-bad': !!drop && !drop.ok && drop.highlight === row.node.path,
            selected: row.node.path === state.activePath,
            focused: idx === focusIndex,
            dir: row.node.isDir,
            'pin-head': row.node.isVirtual,
            'pinned-card': row.pinnedCopy,
            'has-sep': row.sepAfter,
          }"
          :style="
            row.node.isVirtual || row.pinnedCopy
              ? undefined
              : { paddingLeft: `${6 + row.depth * 16}px` }
          "
          @click="focusIndex = idx; onRow(row.node)"
          @pointerdown="onDragStart($event, row)"
        >
          <span
            class="twisty"
            :class="{
              blank: !row.node.isDir,
              open: row.node.isDir && state.expanded.has(row.node.path),
            }"
            @click.stop="row.node.isDir && toggleExpand(row.node.path)"
          >
            <Icon v-if="row.node.isDir" name="chevron-right" :size="13" />
          </span>
          <Icon v-if="!row.node.isVirtual" :name="row.node.isDir ? 'folder' : 'file'" :size="15" />
          <span class="label">{{ row.node.name }}</span>
          <Icon
            v-if="!row.node.isVirtual && isPinned(row.node.path)"
            class="pin-mark"
            name="pin"
            :size="11"
            title="已置顶"
          />
          <span
            v-if="row.node.path === state.activePath && state.saveState === 'dirty'"
            class="pen"
            title="未保存"
          />
        </div>

        <div v-if="state.root && !visibleRows.length" key="__empty" class="tree-empty">
          <Icon name="file" :size="20" />
          <p>知识库还是空的</p>
          <span>右键目录树可导入已有的 Markdown 文件，或新建一篇。</span>
          <button class="tree-empty-btn" @click="importInto(state.root)">导入 Markdown…</button>
        </div>
      </TransitionGroup>
    </div>

    <div class="rail-footer">
      {{ state.root || "数据目录初始化中…" }}{{ state.dataFallback ? "（AppData 降级）" : "" }}
    </div>
    <Teleport to="body">
      <div
        v-if="ghost"
        class="tree-drag-ghost"
        :style="{ left: `${ghost.x + 14}px`, top: `${ghost.y + 10}px` }"
      >
        <Icon :name="dragIcon" :size="14" />
        <span>{{ drag?.name }}</span>
      </div>
    </Teleport>
  </aside>
</template>
