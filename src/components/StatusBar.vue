<script setup lang="ts">
import { computed, ref } from "vue";
import { isUntitledPath, saveActive, state, toggleReadonly } from "../store";
import { checkForUpdates, updateState } from "../update";

/** 版本号（构建时注入，不需要额外 IPC） */
const appVersion = ref("");

void import("@tauri-apps/api/app")
  .then((m) => m.getVersion())
  .then((v) => {
    appVersion.value = v;
  })
  .catch(() => {
    appVersion.value = "";
  });

const updateLabel = computed(() => {
  if (updateState.busy) return updateState.message || "更新中…";
  if (updateState.available) return `有新版本 v${updateState.available}`;
  return "检查更新";
});

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

    <button
      v-if="state.activePath && state.editorMode === 'source'"
      class="status-btn readonly-btn"
      :title="state.readonly ? '切换为可编辑（Ctrl+Shift+E）' : '切换为只读（Ctrl+Shift+E）'"
      :aria-pressed="state.readonly"
      @click="toggleReadonly"
    >
      {{ state.readonly ? "只读" : "可编辑" }}
    </button>

    <div class="status-group grow">
      <span>{{ chars }} 字</span>
      <template v-if="state.notice">
        <span>·</span>
        <span class="status-text notice" :title="state.notice">{{ state.notice }}</span>
      </template>
      <template v-else-if="state.error">
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
      <span v-if="appVersion" class="status-sep" />
      <span v-if="appVersion" class="ver">v{{ appVersion }}</span>
      <button
        class="status-btn update-btn"
        :class="{ busy: updateState.busy, hot: !!updateState.available }"
        :title="updateState.error || '检查是否有新版本'"
        :disabled="updateState.checking || updateState.busy"
        @click="checkForUpdates"
      >
        <span
          class="update-dot"
          :class="{ active: updateState.checking || updateState.busy, hot: !!updateState.available, err: !!updateState.error }"
        />
        {{ updateLabel }}
      </button>
    </div>
  </footer>
</template>
