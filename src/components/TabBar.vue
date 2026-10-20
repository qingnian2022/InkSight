<script setup lang="ts">
import { activate, closeTab, newDoc, state, toggleTheme } from "../store";
import AccentPicker from "./AccentPicker.vue";
import Icon from "./Icon.vue";
</script>

<template>
  <div class="tabbar" role="tablist" aria-label="已打开的文件">
    <button
      v-if="state.railCollapsed"
      class="tool-btn rail-toggle"
      title="展开目录 Ctrl+\"
      aria-label="展开目录"
      @click="state.railCollapsed = false"
    >
      <Icon name="panel" :size="15" />
    </button>

    <div
      v-for="tab in state.tabs"
      :key="tab.path"
      class="tab"
      :class="{ active: tab.path === state.activePath, dirty: tab.dirty }"
      role="tab"
      :aria-selected="tab.path === state.activePath"
      :title="tab.path"
      @click="activate(tab.path)"
    >
      <Icon name="file" :size="14" />
      <span v-if="tab.dirty" class="dot" title="未保存" />
      <span class="name">{{ tab.name }}</span>
      <button class="close" aria-label="关闭文件" title="关闭 Ctrl+W" @click.stop="closeTab(tab.path)">
        <Icon name="close" :size="11" />
      </button>
    </div>

    <button class="tab-new" title="新建文档 Ctrl+N" aria-label="新建文档" @click="newDoc">
      <Icon name="plus" :size="15" />
    </button>

    <div class="tabbar-actions">
      <AccentPicker />
      <button
        class="tool-btn"
        :aria-pressed="state.outlineOpen"
        title="大纲 Ctrl+Shift+O"
        aria-label="大纲"
        @click="state.outlineOpen = !state.outlineOpen"
      >
        <Icon name="outline" :size="15" />
      </button>
      <button class="tool-btn" title="切换浅色 / 深色" aria-label="切换主题" @click="toggleTheme">
        <Icon :name="state.theme === 'dark' ? 'sun' : 'moon'" :size="15" />
      </button>
    </div>
  </div>
</template>
