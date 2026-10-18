<script setup lang="ts">
import { activate, closeTab, newDoc, state, toggleReadonly, toggleTheme } from "../store";
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
      <span class="tool-sep" />
      <button
        class="tool-btn"
        :aria-pressed="state.outlineOpen"
        title="大纲 Ctrl+Shift+O"
        aria-label="大纲"
        @click="state.outlineOpen = !state.outlineOpen"
      >
        <Icon name="outline" :size="15" />
      </button>
      <button
        class="tool-btn"
        :aria-pressed="state.readonly"
        :title="state.readonly ? '当前是阅读态，点击进入编辑（Ctrl+E）' : '切回阅读（Ctrl+E）'"
        aria-label="阅读或编辑"
        @click="toggleReadonly"
      >
        <Icon :name="state.readonly ? 'eye' : 'pencil'" :size="15" />
      </button>
      <button class="tool-btn" title="切换浅色 / 深色" aria-label="切换主题" @click="toggleTheme">
        <Icon :name="state.theme === 'dark' ? 'sun' : 'moon'" :size="15" />
      </button>
    </div>
  </div>
</template>
