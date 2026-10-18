<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { closeContextMenu, ctxState } from "../ui/contextMenu";

const root = ref<HTMLElement | null>(null);
const pos = ref({ x: 0, y: 0 });

// 打开时按视口翻转位置，避免贴边溢出；并聚焦第一项，让 Esc / 方向键可用
watch(
  () => ctxState.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    const el = root.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    pos.value = {
      x: Math.max(8, Math.min(ctxState.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(ctxState.y, window.innerHeight - rect.height - 8)),
    };
    el.querySelector<HTMLButtonElement>(".ctx-item:not([disabled])")?.focus();
  },
);

function onDocMouseDown(e: MouseEvent) {
  if (!ctxState.open) return;
  if (e.target instanceof Node && root.value && !root.value.contains(e.target)) {
    closeContextMenu();
  }
}

function onKeydown(e: KeyboardEvent) {
  if (!ctxState.open) return;
  if (e.key === "Escape") {
    closeContextMenu();
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const items = [
      ...(root.value?.querySelectorAll<HTMLButtonElement>(".ctx-item:not([disabled])") ?? []),
    ];
    if (!items.length) return;
    e.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "ArrowDown"
        ? (current + 1) % items.length
        : (current - 1 + items.length) % items.length;
    items[next].focus();
  }
}

function run(action: (() => void) | undefined) {
  if (!action) return;
  closeContextMenu();
  action();
}

onMounted(() => {
  document.addEventListener("mousedown", onDocMouseDown, true);
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocMouseDown, true);
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div
    v-if="ctxState.open"
      ref="root"
      class="ctx-menu"
      role="menu"
      :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
      @contextmenu.prevent
    >
      <template v-for="(item, i) in ctxState.items" :key="i">
        <div v-if="item.separator" class="ctx-sep" role="separator" />
        <button
          v-else
          class="ctx-item"
          role="menuitem"
          type="button"
          :disabled="item.disabled"
          @click="run(item.action)"
        >
          <span>{{ item.label }}</span>
          <kbd v-if="item.shortcut">{{ item.shortcut }}</kbd>
        </button>
      </template>
  </div>
</template>
