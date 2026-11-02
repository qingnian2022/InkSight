<script setup lang="ts">
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onBeforeUnmount, onMounted, ref } from "vue";
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

/* ---------- 细滚动条：覆盖在标签栏底部，不占高度 ---------- */
const barEl = ref<HTMLElement | null>(null);
const trackEl = ref<HTMLElement | null>(null);
const thumbW = ref(0);
const thumbX = ref(0);
const thumbVisible = ref(false);
let hideTimer = 0;
let resizeObs: ResizeObserver | null = null;
let hovering = false;

function syncThumb(): boolean {
  const el = trackEl.value;
  if (!el) return false;
  const max = el.scrollWidth - el.clientWidth;
  // 内容放得下 → 不显示细条
  if (max <= 4) {
    thumbW.value = 0;
    thumbVisible.value = false;
    return false;
  }
  const track = Math.max(0, el.clientWidth - 20);
  const w = Math.max(28, Math.round((el.clientWidth / el.scrollWidth) * track));
  thumbW.value = w;
  thumbX.value = Math.round((el.scrollLeft / max) * Math.max(0, track - w));
  return true;
}

function reveal(sticky = false) {
  if (!syncThumb()) return;
  thumbVisible.value = true;
  window.clearTimeout(hideTimer);
  if (!sticky) {
    hideTimer = window.setTimeout(() => {
      if (!hovering) thumbVisible.value = false;
    }, 900);
  }
}

function onMove() {
  reveal(true);
}

function onEnter() {
  hovering = true;
  reveal(true);
}

function onLeave() {
  hovering = false;
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    thumbVisible.value = false;
  }, 220);
}

function onScroll() {
  reveal();
}

/** 滚轮横向滚动标签：普通滚轮用 deltaY，触控板横向用 deltaX */
function onWheel(event: WheelEvent) {
  const el = trackEl.value;
  if (!el) return;
  const max = el.scrollWidth - el.clientWidth;
  if (max <= 4) return;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!delta) return;
  event.preventDefault();
  el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + delta));
  reveal();
}

/** 拖动细滚动条 */
function onThumbDown(event: PointerEvent) {
  const el = trackEl.value;
  if (!el) return;
  event.preventDefault();
  const startX = event.clientX;
  const startLeft = el.scrollLeft;
  const track = Math.max(1, el.clientWidth - 20 - thumbW.value);
  const max = el.scrollWidth - el.clientWidth;
  const move = (e: PointerEvent) => {
    const dx = e.clientX - startX;
    el.scrollLeft = startLeft + (dx / track) * max;
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

onMounted(() => {
  const track = trackEl.value;
  const bar = barEl.value;
  if (!track) return;
  track.addEventListener("scroll", onScroll, { passive: true });
  track.addEventListener("wheel", onWheel, { passive: false });
  bar?.addEventListener("pointerenter", onEnter);
  bar?.addEventListener("pointerleave", onLeave);
  bar?.addEventListener("pointermove", onMove);
  if ("ResizeObserver" in window) {
    resizeObs = new ResizeObserver(() => {
      if (!syncThumb()) thumbVisible.value = false;
    });
    resizeObs.observe(track);
  }
  syncThumb();
});

onBeforeUnmount(() => {
  const track = trackEl.value;
  const bar = barEl.value;
  track?.removeEventListener("scroll", onScroll);
  track?.removeEventListener("wheel", onWheel);
  bar?.removeEventListener("pointerenter", onEnter);
  bar?.removeEventListener("pointerleave", onLeave);
  bar?.removeEventListener("pointermove", onMove);
  window.clearTimeout(hideTimer);
  resizeObs?.disconnect();
});

/** 双击标签栏空白处：最大化/还原（仅桌面版） */
function onBarDoubleClick(event: MouseEvent) {
  if (!("__TAURI_INTERNALS__" in window)) return;
  if ((event.target as HTMLElement).closest(".tab, button")) return;
  void getCurrentWindow().toggleMaximize();
}
</script>

<template>
  <div
    ref="barEl"
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

    <div ref="trackEl" class="tabbar-track">
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
    </div>

    <div
      class="tabbar-thumb"
      :class="{ visible: thumbVisible }"
      :style="{ width: `${thumbW}px`, transform: `translateX(${thumbX}px)` }"
      @pointerdown="onThumbDown"
    />

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
