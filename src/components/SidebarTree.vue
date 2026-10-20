<script setup lang="ts">
import { computed } from "vue";
import { importInto, isPinned, newDoc, openDataFolder, openDoc, refresh, state, toggleExpand, visibleRows } from "../store";
import type { FsNode } from "../types";
import Icon from "./Icon.vue";

function onRow(node: FsNode) {
  if (node.isDir) toggleExpand(node.path);
  else void openDoc(node);
}

/** 分隔线挂在「置顶子树最后一行」之后：展开时是最后一个子项，折叠时是「置顶」行本身。 */
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
      <button class="tool-btn" title="新建文档 Ctrl+N" aria-label="新建文档" @click="newDoc">
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

    <div class="tree" role="tree">
      <template v-for="row in rowsWithSep" :key="row.node.path">
        <div
          class="tree-row"
          role="treeitem"
          :data-path="row.node.isVirtual ? undefined : row.node.path"
          :aria-expanded="row.node.isDir ? state.expanded.has(row.node.path) : undefined"
          :class="{
            selected: row.node.path === state.activePath,
            dir: row.node.isDir,
            'pinned-folder': row.node.isVirtual,
          }"
          :style="{ paddingLeft: `${6 + row.depth * 16}px` }"
          @click="onRow(row.node)"
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
        <div v-if="row.sepAfter" class="pin-separator" role="separator" />
      </template>

      <div v-if="state.root && !visibleRows.length" class="tree-empty">
        <Icon name="file" :size="20" />
        <p>知识库还是空的</p>
        <span>右键目录树可导入已有的 Markdown 文件，或新建一篇。</span>
        <button class="tree-empty-btn" @click="importInto(state.root)">导入 Markdown…</button>
      </div>
    </div>

    <div class="rail-footer">
      {{ state.root || "数据目录初始化中…" }}{{ state.dataFallback ? "（AppData 降级）" : "" }}
    </div>
  </aside>
</template>
