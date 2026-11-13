<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";
import { state } from "../store";
import Icon from "./Icon.vue";
import {
  clearActive,
  closeSession,
  mountSession,
  newSession,
  refitAll,
  setActive,
  setHeight,
  termStore,
  toggleDock,
} from "../terminal";

/**
 * full = 终端模块的主区形态：铺满右侧整块，没有可拖拽的高度，
 * 也不参与 Dock 的收起（收起只对笔记页下沿的形态有意义）。
 * dock = 允许以「下沿 Dock」形态出现（只有笔记模块是 true）；
 * 文件 / 搜索模块里即便之前开着 Dock，也不该在这两个模块页脚下露出一截终端。
 */
const props = defineProps<{ full?: boolean; dock?: boolean }>();

const active = computed(
  () => termStore.sessions.find((s) => s.id === termStore.activeId) ?? null,
);
const activeTitle = computed(() => active.value?.title ?? "终端");

// 铺满主区时尺寸变化最大（240px → 整块），补一次重算并接回焦点
watch(
  () => props.full,
  (full) => {
    if (!full) return;
    refitAll();
    if (termStore.activeId) setActive(termStore.activeId);
  },
);

/** 每个会话一个宿主 div；xterm 由 terminal.ts 挂进来，组件只管 DOM 位置。 */
function bindHost(id: number, el: unknown) {
  if (el instanceof HTMLElement) mountSession(id, el);
}

/* ---------- 拖拽调整高度（往上拖变高） ---------- */
let drag: { y: number; h: number } | null = null;

function onResizeMove(event: PointerEvent) {
  if (!drag) return;
  setHeight(drag.h + (drag.y - event.clientY));
}

function stopResize() {
  drag = null;
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", stopResize);
  document.body.classList.remove("term-resizing");
}

function startResize(event: PointerEvent) {
  event.preventDefault();
  drag = { y: event.clientY, h: termStore.height };
  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", stopResize);
  document.body.classList.add("term-resizing");
}

onBeforeUnmount(stopResize);
</script>

<template>
  <section
    v-show="props.full || (props.dock && termStore.open)"
    class="term-dock"
    :class="{ full: props.full }"
    :style="props.full ? undefined : { height: `${termStore.height}px` }"
    aria-label="终端"
  >
    <div v-if="!props.full" class="term-resize" title="拖拽调整终端高度" @pointerdown="startResize" />

    <header class="term-head">
      <!-- 侧栏收起时退回标签形态：否则没有地方切会话 -->
      <template v-if="props.full && !state.railCollapsed">
        <span class="term-dot" :class="{ dead: !active?.alive }" />
        <span class="term-current">{{ activeTitle }}</span>
        <span class="term-meta">本地 · Windows PowerShell</span>
        <span class="term-gap" />
        <button
          class="tool-btn"
          title="新建终端 Ctrl+Shift+`"
          aria-label="新建终端"
          @click="newSession()"
        >
          <Icon name="plus" :size="14" />
        </button>
        <button
          class="tool-btn"
          title="清屏（等同于终端里 Ctrl+L）"
          aria-label="清屏"
          :disabled="!active"
          @click="clearActive"
        >
          <Icon name="refresh" :size="14" />
        </button>
        <button
          class="tool-btn"
          title="关闭当前会话"
          aria-label="关闭当前会话"
          :disabled="!active"
          @click="closeSession(termStore.activeId)"
        >
          <Icon name="close" :size="14" />
        </button>
      </template>

      <template v-else>
        <span class="term-title">终端</span>
        <div class="term-tabs">
          <button
            v-for="s in termStore.sessions"
            :key="s.id"
            class="term-tab"
            :class="{ on: s.id === termStore.activeId }"
            :title="s.alive ? s.title : `${s.title}（进程已退出）`"
            @click="setActive(s.id)"
          >
            <span class="term-dot" :class="{ dead: !s.alive }" />
            <span class="term-name">{{ s.title }}</span>
            <span class="term-x" role="button" aria-label="关闭终端" @click.stop="closeSession(s.id)">
              <Icon name="close" :size="10" />
            </span>
          </button>
        </div>
        <button
          class="tool-btn"
          title="新建终端 Ctrl+Shift+`"
          aria-label="新建终端"
          @click="newSession()"
        >
          <Icon name="plus" :size="14" />
        </button>
        <button
          class="tool-btn"
          title="收起终端 Ctrl+`"
          aria-label="收起终端"
          @click="toggleDock"
        >
          <Icon name="chevron" :size="14" />
        </button>
      </template>
    </header>

    <div class="term-body">
      <div
        v-for="s in termStore.sessions"
        v-show="s.id === termStore.activeId"
        :key="s.id"
        class="term-pane"
        :ref="(el) => bindHost(s.id, el)"
      />
      <div v-if="!termStore.sessions.length" class="term-empty">
        <Icon name="terminal" :size="24" />
        <p :class="{ error: !!termStore.error }">
          {{ termStore.error || "没有活动的终端会话" }}
        </p>
        <button class="term-cta" @click="newSession()">新建终端</button>
      </div>
    </div>
  </section>
</template>
