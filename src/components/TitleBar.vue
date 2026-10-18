<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Icon from "./Icon.vue";

/**
 * 自绘系统标题栏：去掉原生窗口边框后，这一条承担拖拽、双击最大化
 * 和最小化 / 最大化 / 关闭，颜色与内部主题保持一致。
 * 浏览器里（npm run dev）没有 Tauri 后端，只显示应用名，不渲染窗口按钮。
 */
const isTauri = "__TAURI_INTERNALS__" in window;
const maximized = ref(false);
let unlisten: (() => void) | null = null;

function minimize() {
  void getCurrentWindow().minimize();
}

async function toggleMaximize() {
  const win = getCurrentWindow();
  await win.toggleMaximize();
  maximized.value = await win.isMaximized();
}

function close() {
  void getCurrentWindow().close();
}

onMounted(async () => {
  if (!isTauri) return;
  const win = getCurrentWindow();
  maximized.value = await win.isMaximized();
  unlisten = await win.onResized(async () => {
    maximized.value = await win.isMaximized();
  });
});

onBeforeUnmount(() => {
  unlisten?.();
  unlisten = null;
});
</script>

<template>
  <header class="titlebar" data-tauri-drag-region>
    <span class="titlebar-title" data-tauri-drag-region>md-rust</span>

    <div v-if="isTauri" class="titlebar-controls">
      <button class="win-btn" aria-label="最小化" title="最小化" @click="minimize">
        <Icon name="minus" :size="14" />
      </button>
      <button
        class="win-btn"
        :aria-label="maximized ? '还原' : '最大化'"
        :title="maximized ? '向下还原' : '最大化'"
        @click="toggleMaximize"
      >
        <Icon :name="maximized ? 'win-restore' : 'win-max'" :size="13" />
      </button>
      <button class="win-btn win-close" aria-label="关闭" title="关闭" @click="close">
        <Icon name="close" :size="13" />
      </button>
    </div>
  </header>
</template>
