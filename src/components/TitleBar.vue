<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { setAutoSave, state } from "../store";
import Icon from "./Icon.vue";
import SyncMenu from "./SyncMenu.vue";

/**
 * 自绘系统标题栏：去掉原生窗口边框后，这一条承担拖拽、双击最大化
 * 和最小化 / 最大化 / 关闭，颜色与内部主题保持一致。
 * 浏览器里（npm run dev）没有 Tauri 后端，只显示应用名，不渲染窗口按钮。
 */
// DEV 预览用 ?winbtns=1 强制渲染窗口按钮（正式构建里该分支被替换为 false）
const isTauri =
  "__TAURI_INTERNALS__" in window ||
  (import.meta.env.DEV && new URLSearchParams(location.search).has("winbtns"));
const maximized = ref(false);
let unlisten: (() => void) | null = null;

function minimize() {
  if (!isTauri) return;
  void getCurrentWindow().minimize();
}

async function toggleMaximize() {
  if (!isTauri) return;
  const win = getCurrentWindow();
  await win.toggleMaximize();
  maximized.value = await win.isMaximized();
}

function close() {
  if (!isTauri) return;
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
  <header
    class="titlebar"
    :class="{ 'is-macos': state.skin === 'macos' }"
    data-tauri-drag-region
  >
    <div class="titlebar-left" data-tauri-drag-region>
      <img class="titlebar-logo" src="/app-icon.png" alt="" draggable="false" />
      <span class="titlebar-title" data-tauri-drag-region>Inksight</span>
    </div>

    <div class="titlebar-controls">
      <SyncMenu />

      <button
        class="as-toggle"
        :title="state.autoSave ? '自动保存：开（停止输入约 0.8 秒写盘）' : '自动保存：关（Ctrl+S 手动写盘）'"
        :aria-pressed="state.autoSave"
        @click="setAutoSave(!state.autoSave)"
      >
        <span>自动保存</span>
        <span class="as-slider" :class="{ on: state.autoSave }" />
      </button>

      <!-- 窗口按钮统一放右侧，顺序遵循 Windows：最小化 / 最大化 / 关闭 -->
      <div v-if="isTauri" class="win-btns" @pointerdown.stop>
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
    </div>
  </header>
</template>
