<script setup lang="ts">
import { getCurrentWindow } from "@tauri-apps/api/window";
import { activate, closeTab, newDoc, state, toggleTheme } from "../store";
import AccentPicker from "./AccentPicker.vue";
import WidthPicker from "./WidthPicker.vue";
import Icon from "./Icon.vue";

/** 中键关闭标签：和浏览器/编辑器一致 */
function onTabAux(event: MouseEvent, path: string) {
  if (event.button !== 1) return;
  event.preventDefault();
  void closeTab(path);
}

/** 双击标签栏空白处：最大化/还原（仅桌面版） */
function onBarDoubleClick(event: MouseEvent) {
  if (!("__TAURI_INTERNALS__" in window)) return;
  if ((event.target as HTMLElement).closest(".tab, button")) return;
  void getCurrentWindow().toggleMaximize();
}
</script>

<template>
  <div
    class="tabbar"
    role="tablist"
    aria-label="已打开的文件"
    @dblclick="onBarDoubleClick"
  >
    <button
      v-if="state.railCollapsed"
      class="tool-btn rail-toggle"
      title="展开目录 Ctrl+\"
      aria-label="展开目录"
      @click="state.railCollapsed = false"
    >
      <Icon name="panel" :size="15" />
    </button>

    <TransitionGroup name="tab" tag="div" class="tab-strip">
      <div
        v-for="tab in state.tabs"
        :key="tab.path"
        class="tab"
        :class="{ active: tab.path === state.activePath, dirty: tab.dirty }"
        role="tab"
        :aria-selected="tab.path === state.activePath"
        :title="tab.path"
        @click="activate(tab.path)"
        @auxclick="onTabAux($event, tab.path)"
      >
        <Icon name="file" :size="14" />
        <span v-if="tab.dirty" class="dot" title="未保存" />
        <span class="name">{{ tab.name }}</span>
        <button class="close" aria-label="关闭文件" title="关闭 Ctrl+W" @click.stop="closeTab(tab.path)">
          <Icon name="close" :size="11" />
        </button>
      </div>
    </TransitionGroup>

    <button class="tab-new" title="新建文档 Ctrl+N" aria-label="新建文档" @click="() => newDoc()">
      <Icon name="plus" :size="15" />
    </button>

    <div class="tabbar-actions">
      <WidthPicker />
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
