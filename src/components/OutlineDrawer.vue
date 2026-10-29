<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { scrollToHeading } from "../editor/viewRef";
import { outline, state } from "../store";
import Icon from "./Icon.vue";

const listEl = ref<HTMLElement | null>(null);
const activeIndex = ref(0);
let scroller: HTMLElement | null = null;
let raf = 0;

/** 同名标题按出现顺序跳转，避免每次都跳到第一个 */
function go(item: { text: string }) {
  const same = outline.value.filter((o) => o.text === item.text);
  scrollToHeading(item.text, Math.max(0, same.indexOf(item as (typeof same)[number])));
}

/** 编辑器/滚动容器可能比大纲晚创建，每次用时现查 */
function currentScroller(): HTMLElement | null {
  scroller = document.querySelector<HTMLElement>(".milkdown");
  return scroller;
}

/** 取最后一个「已滚过顶部安全线」的标题作为当前章节 */
function syncActive() {
  if (jumping) return;
  const sc = currentScroller();
  if (!sc || !outline.value.length) return;
  const heads = Array.from(
    sc.querySelectorAll<HTMLElement>(".ProseMirror > h1, .ProseMirror > h2, .ProseMirror > h3, .ProseMirror > h4, .ProseMirror > h5, .ProseMirror > h6"),
  );
  if (!heads.length) return;
  const base = sc.getBoundingClientRect().top;
  // 落点本身在 scroller 顶部下方 54px（工具栏 42 + 12），安全线取 60 才不会高亮到上一节
  const line = sc.scrollTop + 60;
  let index = 0;
  heads.forEach((el, i) => {
    const top = el.getBoundingClientRect().top - base + sc.scrollTop;
    if (top <= line) index = i;
  });
  activeIndex.value = Math.min(index, outline.value.length - 1);
  ensureVisible(activeIndex.value);
}

/** 让高亮项在抽屉自己的列表里可见（不滚动页面） */
function ensureVisible(index: number) {
  const list = listEl.value;
  const el = list?.querySelector<HTMLElement>(`[data-idx="${index}"]`);
  if (!list || !el) return;
  const top = el.offsetTop;
  const bottom = top + el.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = Math.max(0, top - 6);
  else if (bottom > list.scrollTop + list.clientHeight) {
    list.scrollTop = bottom - list.clientHeight + 6;
  }
}

let ticker = 0;
let lastTop = -1;
/** 程序化跳转期间暂停「按滚动位置反推高亮」，等滚动停稳后再校准 */
let jumping = false;
let stableTicks = 0;
let lastJumpTop = -1;

/** 滚动事件在部分容器上不稳定，用轻量轮询兜底（只在滚动位置变化时计算） */
function tick() {
  const sc = currentScroller();
  if (!sc) return;

  // 跳转中：连续 3 次（约 600ms）位置不变才算停稳，随后校准一次
  if (jumping) {
    if (Math.abs(sc.scrollTop - lastJumpTop) <= 1) {
      stableTicks += 1;
      if (stableTicks >= 3) {
        jumping = false;
        lastTop = sc.scrollTop;
        syncActive();
      }
    } else {
      stableTicks = 0;
      lastJumpTop = sc.scrollTop;
    }
    return;
  }

  if (sc.scrollTop === lastTop) return;
  lastTop = sc.scrollTop;
  syncActive();
}

function onScroll() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(syncActive);
}

watch([() => state.activePath, () => state.tabReloadToken], async () => {
  await nextTick();
  lastTop = -1;
  syncActive();
});

/** 点击大纲：立即高亮，滚动结束后再同步一次，避免平滑滚动期间的中间态留在高亮上 */
function select(index: number) {
  activeIndex.value = index;
  ensureVisible(index);
  jumping = true;
  stableTicks = 0;
  lastJumpTop = currentScroller()?.scrollTop ?? 0;
  const item = outline.value[index];
  if (item) go(item);
}

function onKeydown(event: KeyboardEvent) {
  if (!outline.value.length) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    activeIndex.value = Math.min(outline.value.length - 1, activeIndex.value + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    activeIndex.value = Math.max(0, activeIndex.value - 1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const item = outline.value[activeIndex.value];
    if (item) {
      jumping = true;
      stableTicks = 0;
      lastJumpTop = currentScroller()?.scrollTop ?? 0;
      go(item);
    }
  } else {
    return;
  }
  ensureVisible(activeIndex.value);
}

onMounted(async () => {
  await nextTick();
  document.addEventListener("scroll", onScroll, true);
  syncActive();
  ticker = window.setInterval(tick, 200);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  window.clearInterval(ticker);
  document.removeEventListener("scroll", onScroll, true);
});
</script>

<template>
  <aside class="outline-drawer" :class="{ open: state.outlineOpen }" aria-label="大纲">
    <div class="drawer-head">
      大纲
      <button class="tool-btn" aria-label="关闭大纲" title="关闭" @click="state.outlineOpen = false">
        <Icon name="close" :size="13" />
      </button>
    </div>
    <div
      ref="listEl"
      class="outline"
      tabindex="0"
      role="listbox"
      aria-label="文档标题"
      :aria-activedescendant="`outline-item-${activeIndex}`"
      @keydown="onKeydown"
    >
      <div
        v-for="(item, idx) in outline"
        :id="`outline-item-${idx}`"
        :key="`${item.line}-${item.text}`"
        :data-idx="idx"
        class="outline-item"
        :class="[`lv${Math.min(item.level, 3)}`, { active: idx === activeIndex }]"
        role="option"
        :aria-selected="idx === activeIndex"
        @click="select(idx)"
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
