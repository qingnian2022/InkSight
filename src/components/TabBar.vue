<script setup lang="ts">
import { activate, closeTab, newDoc, state } from "../store";
import Icon from "./Icon.vue";
</script>

<template>
  <div class="tabbar" role="tablist" aria-label="已打开的文件">
    <div
      v-for="tab in state.tabs"
      :key="tab.path"
      class="tab"
      :class="{ active: tab.path === state.activePath }"
      role="tab"
      :aria-selected="tab.path === state.activePath"
      :title="tab.path"
      @click="activate(tab.path)"
    >
      <Icon name="file" :size="14" />
      <span class="name">{{ tab.name }}</span>
      <span v-if="tab.dirty" class="dot" title="未保存" />
      <button class="close" aria-label="关闭文件" title="关闭 Ctrl+W" @click.stop="closeTab(tab.path)">
        <Icon name="close" :size="11" />
      </button>
    </div>

    <div class="tabbar-actions">
      <button class="tool-btn" title="新建文档 Ctrl+N" aria-label="新建文档" @click="newDoc">
        <Icon name="plus" :size="15" />
      </button>
    </div>
  </div>
</template>
