<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { EDITOR_WIDTHS, setEditorWidth, state, type EditorWidth } from "../store";
import Icon from "./Icon.vue";

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const btnRef = ref<HTMLElement | null>(null);
// 菜单用 fixed 定位：标签栏有 overflow-x，absolute 会被裁剪
const menuPos = ref({ top: 0, left: 0 });

function toggle() {
  open.value = !open.value;
  if (open.value && btnRef.value) {
    const r = btnRef.value.getBoundingClientRect();
    menuPos.value = { top: Math.round(r.bottom + 6), left: Math.round(r.right - 196) };
  }
}
const currentLabel = computed(
  () => EDITOR_WIDTHS.find((w) => w.key === state.editorWidth)?.label ?? "标准",
);

function pick(key: EditorWidth) {
  setEditorWidth(key);
  open.value = false;
}

function onDocMouseDown(e: MouseEvent) {
  if (!open.value) return;
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}

function onKey(e: KeyboardEvent) {
  if (open.value && e.key === "Escape") open.value = false;
}

onMounted(() => {
  document.addEventListener("mousedown", onDocMouseDown);
  window.addEventListener("keydown", onKey);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocMouseDown);
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div ref="root" class="wp-wrap">
    <button
      class="md-tb-item md-tb-text wp-btn"
      :aria-expanded="open"
      title="正文列宽"
      aria-label="正文列宽"
      ref="btnRef"
      @click="toggle"
    >
      <Icon name="columns" :size="16" />
      <span class="md-tb-label">{{ currentLabel }}</span>
      <Icon name="chevron" :size="11" />
    </button>

    <div
      v-if="open"
      class="wp-menu"
      role="menu"
      aria-label="列宽选项"
      :style="{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }"
    >
      <button
        v-for="opt in EDITOR_WIDTHS"
        :key="opt.key"
        class="wp-item"
        :class="{ active: state.editorWidth === opt.key }"
        role="menuitem"
        @click="pick(opt.key)"
      >
        <span class="wp-check">{{ state.editorWidth === opt.key ? "✓" : "" }}</span>
        <span>{{ opt.label }}</span>
        <kbd>{{ opt.hint }}</kbd>
      </button>
    </div>
  </div>
</template>
