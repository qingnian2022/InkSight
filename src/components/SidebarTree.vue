<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import {
  importInto,
  isPinned,
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
  if (node.isDir) toggleExpand(node.path);
  else void openDoc(node);
}

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
            selected: row.node.path === state.activePath,
            focused: idx === focusIndex,
            dir: row.node.isDir,
            'pinned-folder': row.node.isVirtual,
            'has-sep': row.sepAfter,
          }"
          :style="{ paddingLeft: `${6 + row.depth * 16}px` }"
          @click="focusIndex = idx; onRow(row.node)"
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
          <span v-if="row.node.isVirtual" class="pin-folder-glyph" title="置顶">📌</span>
          <Icon v-else :name="row.node.isDir ? 'folder' : 'file'" :size="15" />
          <span class="label">{{ row.node.name }}</span>
          <span v-if="isPinned(row.node.path)" class="pin-mark" title="已置顶">📌</span>
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
  </aside>
</template>
