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
        :data-path="row.node.path"
        :aria-expanded="row.node.isDir ? state.expanded.has(row.node.path) : undefined"
        :class="{ selected: row.node.path === state.activePath, dir: row.node.isDir }"
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
        <Icon :name="row.node.isDir ? 'folder' : 'file'" :size="15" />
        <span class="label">{{ row.node.name }}</span>
        <span
          v-if="row.node.path === state.activePath && state.saveState === 'dirty'"
          class="pen"
          title="未保存"
        />
      </div>

      <div v-if="!state.root" class="tree-empty">
        <Icon name="folder" :size="22" />
        <p>还没有打开知识库</p>
        <span>选择一个文件夹，里面的 .md 会出现在这里。</span>
        <button class="tree-empty-btn" @click="pickVault">选择文件夹</button>
      </div>
      <div v-else-if="!visibleRows.length" class="tree-empty">
        <Icon name="file" :size="20" />
        <p>这个文件夹还是空的</p>
        <span>新建一篇 Markdown，或把已有的文件放进来。</span>
      </div>
    </div>

    <div class="rail-footer">{{ state.root || "未选择知识库" }}</div>
  </aside>
</template>
