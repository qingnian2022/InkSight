<script setup lang="ts">
import { computed } from "vue";
import { saveActive, state } from "../store";

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
const path = computed(() => state.activePath);
</script>

<template>
  <footer class="statusbar" :class="{ dirty: state.saveState === 'dirty' }">
    <button
      class="status-group"
      title="点击立即保存 Ctrl+S"
      style="background: none; border: 0; padding: 0"
      @click="saveActive"
    >
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
        <span class="status-text error">{{ state.error }}</span>
      </template>
    </div>

    <div class="status-group">
      <span v-if="path" class="path" :title="path">{{ path }}</span>
      <span v-if="path" class="status-sep" />
      <span v-if="path">Ln {{ state.cursor.line }}, Col {{ state.cursor.col }}</span>
      <span v-if="path" class="status-sep" />
      <span>UTF-8</span>
      <span>LF</span>
    </div>
  </footer>
</template>
