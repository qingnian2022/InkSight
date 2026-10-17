<script setup lang="ts">
import { scrollToLine } from "../editor/viewRef";
import { outline, state } from "../store";
import Icon from "./Icon.vue";
</script>

<template>
  <aside class="outline-drawer" :class="{ open: state.outlineOpen }" aria-label="大纲">
    <div class="drawer-head">
      大纲
      <button class="tool-btn" aria-label="关闭大纲" title="关闭" @click="state.outlineOpen = false">
        <Icon name="close" :size="13" />
      </button>
    </div>
    <div class="outline">
      <div
        v-for="item in outline"
        :key="`${item.line}-${item.text}`"
        class="outline-item"
        :class="`lv${Math.min(item.level, 3)}`"
        @click="scrollToLine(item.line)"
      >
        <span class="bar" />
        <span class="label">{{ item.text }}</span>
      </div>
      <div v-if="!outline.length" class="outline-empty">
        当前文档还没有标题。用 # 加空格写一个小标题，它会出现在这里。
      </div>
    </div>
  </aside>
</template>
