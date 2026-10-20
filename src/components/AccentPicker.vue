<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  ACCENT_THEMES,
  accentSwatch,
  setAccent,
  setSkin,
  state,
  type AccentTheme,
  type Skin,
} from "../store";
import Icon from "./Icon.vue";

const SKINS: { key: Skin; label: string }[] = [
  { key: "macos", label: "macOS" },
  { key: "default", label: "经典" },
];

/**
 * 主题色选择器：调色盘按钮 + 四色弹层（石墨 / 紫 / 蓝 / 粉）。
 * 只换主色 token，浅色的整套中性色由 color-mix 派生，深浅主题各自生效。
 * 弹层用 fixed 视口坐标，避免被 tabbar 的滚动/裁剪规则影响。
 */
const open = ref(false);
const wrapEl = ref<HTMLElement | null>(null);
const btnEl = ref<HTMLElement | null>(null);
const menuPos = ref({ top: 0, right: 0 });

function toggle() {
  open.value = !open.value;
  if (open.value && btnEl.value) {
    const rect = btnEl.value.getBoundingClientRect();
    menuPos.value = {
      top: Math.round(rect.bottom + 8),
      right: Math.round(window.innerWidth - rect.right),
    };
  }
}

function pick(key: AccentTheme) {
  setAccent(key);
  open.value = false;
}

function pickSkin(skin: Skin) {
  setSkin(skin);
  open.value = false;
}

function onDocPointerDown(e: PointerEvent) {
  if (!open.value) return;
  if (wrapEl.value?.contains(e.target as Node)) return;
  open.value = false;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") open.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div ref="wrapEl" class="accent-picker">
    <button
      ref="btnEl"
      class="tool-btn"
      title="主题色"
      aria-label="主题色"
      :aria-expanded="open"
      @click="toggle"
    >
      <Icon name="palette" :size="15" />
    </button>

    <div
      v-if="open"
      class="accent-menu"
      :style="{ top: `${menuPos.top}px`, right: `${menuPos.right}px` }"
    >
      <button
        v-for="t in ACCENT_THEMES"
        :key="t.key"
        class="accent-item"
        :class="{ active: state.accent === t.key }"
        @click="pick(t.key)"
      >
        <span class="accent-dot" :style="{ background: accentSwatch(t.key) }" />
        <span>{{ t.label }}</span>
        <Icon v-if="state.accent === t.key" name="check" :size="12" class="accent-check" />
      </button>

      <div class="accent-divider" />
      <p class="accent-group-label">界面风格</p>
      <button
        v-for="s in SKINS"
        :key="s.key"
        class="accent-item"
        :class="{ active: state.skin === s.key }"
        @click="pickSkin(s.key)"
      >
        <span class="accent-skin-glyph" :class="s.key" />
        <span>{{ s.label }}</span>
        <Icon v-if="state.skin === s.key" name="check" :size="12" class="accent-check" />
      </button>
    </div>
  </div>
</template>
