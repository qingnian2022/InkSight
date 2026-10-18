<script setup lang="ts">
import { computed } from "vue";
import { isUntitledPath, saveActive, state } from "../store";

const statusText = computed(() => {
  switch (state.saveState) {
    case "dirty":
      return "未保存";
    case "saving":
      return "保存中…";
    case "error":
      return "保存失败，点此重试";
    default:
      return "已保存";
  }
});

const dotClass = computed(() => (state.saveState === "saved" ? "" : state.saveState));
const chars = computed(() => state.charCount.toLocaleString("zh-CN"));
const path = computed(() => {
  const full = state.activePath;
  if (!full) return "";
  // 未命名文档还没有磁盘路径，显示提示语而不是内部哨兵
  if (isUntitledPath(full)) return "未命名（保存后创建）";
  const root = state.root.replace(/[\\/]+$/, "");
  if (root && full.startsWith(root)) {
    return full.slice(root.length).replace(/^[\\/]+/, "");
  }
  return full;
});
</script>

<template>
  <footer class="statusbar" :class="{ dirty: state.saveState === 'dirty' }">
    <button class="status-btn" title="点击立即保存 Ctrl+S" @click="saveActive">
      <span class="status-dot" :class="dotClass" />
      <span class="status-text" :class="{ error: state.saveState === 'error' }">
        {{ statusText }}
      </span>
    </button>

    <span class="status-sep" />

    <div class="status-group grow">
      <span>{{ chars }} 字</span>
      <template v-if="state.error">
        <span>·</span>
        <span class="status-text error" :title="state.error">{{ state.error }}</span>
      </template>
    </div>

    <div class="status-group">
      <span v-if="path" class="path" :title="state.activePath">{{ path }}</span>
      <span v-if="path" class="status-sep" />
      <span v-if="path">行 {{ state.cursor.line }}，列 {{ state.cursor.col }}</span>
      <span v-if="path" class="status-sep" />
      <span>UTF-8</span>
      <span>LF</span>
    </div>
  </footer>
</template>
