<script setup lang="ts">
import { fileName } from "../api";
import { newDoc, openDoc, pickVault, refresh, state, toggleExpand, visibleRows } from "../store";
import type { FsNode } from "../types";
import Icon from "./Icon.vue";

function onRow(node: FsNode) {
  if (node.isDir) toggleExpand(node.path);
  else void openDoc(node);
}
</script>

<template>
  <aside class="sidebar" aria-label="知识库目录">
    <div class="rail-head">
      <button class="vault-switch" :title="state.root || '选择知识库文件夹'" @click="pickVault">
        <Icon name="folder" :size="15" />
        <span>{{ state.root ? fileName(state.root) : "选择知识库" }}</span>
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
      <div
        v-for="row in visibleRows"
        :key="row.node.path"
        class="tree-row"
        role="treeitem"
        :aria-expanded="row.node.isDir ? state.expanded.has(row.node.path) : undefined"
        :class="{ selected: row.node.path === state.activePath }"
        :style="{ paddingLeft: `${6 + row.depth * 18}px` }"
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
        <Icon :name="row.node.isDir ? 'folder' : 'file'" :size="15" />
        <span class="label">{{ row.node.name }}</span>
        <span
          v-if="row.node.path === state.activePath && state.saveState === 'dirty'"
          class="pen"
          title="未保存"
        />
      </div>

      <div v-if="!state.root" class="tree-empty">
        还没有打开知识库。点左上角选择文件夹，里面的 .md 文件会直接出现在这里。
      </div>
      <div v-else-if="!visibleRows.length" class="tree-empty">
        这个文件夹里还没有 Markdown 文件。
      </div>
    </div>

    <div class="rail-footer">{{ state.root || "未选择知识库" }}</div>
  </aside>
</template>
