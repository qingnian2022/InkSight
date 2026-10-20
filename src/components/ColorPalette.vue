<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  COLOR_DEFAULT_LABEL,
  COLOR_GRAY_ROW,
  COLOR_HUE_ROWS,
  applyColor,
  clearColor,
  closeColorPalette,
  colorPaletteState,
  currentColor,
  locateColorButton,
} from "../editor/color-commands";
import { getPmCtx } from "../editor/pmCtxRef";

/**
 * 语雀式色板弹层：
 * - 第一行「默认」（恢复正文颜色，当前无染色时打 ✓）
 * - 灰阶 10 档
 * - 4 行 × 10 色相（标准 / 浅 / 淡 / 深）
 * 挂在工具栏 A 按钮下方，点击外部 / Esc 关闭。
 */

const el = ref<HTMLElement | null>(null);
const pos = ref({ top: 0, left: 0 });
/** 打开瞬间捕捉光标所在颜色，用于「默认」行的 ✓ */
const activeColor = ref("");

const style = computed(() => ({
  top: `${pos.value.top}px`,
  left: `${pos.value.left}px`,
}));

function place() {
  const btn = locateColorButton();
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const width = el.value?.offsetWidth ?? 290;
  pos.value = {
    top: rect.bottom + 6,
    left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 12)),
  };
}

function pick(color: string) {
  const ctx = getPmCtx();
  if (!ctx) return;
  applyColor(ctx, color);
}

function clear() {
  const ctx = getPmCtx();
  if (!ctx) return;
  clearColor(ctx);
}

function onOutside(e: MouseEvent) {
  if (!colorPaletteState.open) return;
  const target = e.target as HTMLElement;
  if (el.value?.contains(target)) return;
  if (locateColorButton()?.contains(target)) return;
  closeColorPalette();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") closeColorPalette();
}

onMounted(() => {
  document.addEventListener("mousedown", onOutside, true);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", closeColorPalette);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onOutside, true);
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", closeColorPalette);
});

watch(
  () => colorPaletteState.open,
  (open) => {
    if (!open) return;
    const ctx = getPmCtx();
    activeColor.value = ctx ? currentColor(ctx) : "";
    requestAnimationFrame(place);
  },
);
</script>

<template>
  <Teleport to="body">
    <div v-if="colorPaletteState.open" ref="el" class="color-palette" :style="style">
      <!-- 默认：恢复正文颜色 -->
      <button
        type="button"
        class="color-default-row"
        :class="{ active: !activeColor }"
        @click="clear"
      >
        <span class="color-swatch dark" :class="{ checked: !activeColor }">{{ !activeColor ? "✓" : "" }}</span>
        <span>{{ COLOR_DEFAULT_LABEL }}</span>
      </button>

      <div class="color-swatch-row">
        <button
          v-for="c in COLOR_GRAY_ROW"
          :key="c.value"
          type="button"
          class="color-swatch"
          :class="{ dark: true, light: ['银灰', '雾灰', '浅白', '灰白', '白色'].includes(c.label) }"
          :title="c.label"
          :style="{ background: c.value }"
          @click="pick(c.value)"
        />
      </div>

      <div v-for="(row, ri) in COLOR_HUE_ROWS" :key="ri" class="color-swatch-row">
        <button
          v-for="c in row"
          :key="c.value"
          type="button"
          class="color-swatch"
          :title="c.label"
          :style="{ background: c.value }"
          @click="pick(c.value)"
        />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.color-palette {
  position: fixed;
  z-index: 90;
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e3e5e8);
  border-radius: 12px;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.16);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  user-select: none;
}

.color-default-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  border-radius: 7px;
  padding: 4px 6px;
  font-size: 12.5px;
  color: var(--text, #2b2f36);
  cursor: pointer;
}

.color-default-row:hover {
  background: var(--surface-hover, #f0f2f4);
}

.color-swatch-row {
  display: grid;
  grid-template-columns: repeat(10, 20px);
  gap: 6px;
}

.color-swatch {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #fff;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

/* 浅色系色块加深边框，避免在白色面板上隐形 */
.color-swatch.light {
  border-color: rgba(0, 0, 0, 0.18);
}

.color-swatch:hover {
  transform: scale(1.16);
  box-shadow: 0 0 0 2px var(--surface, #fff), 0 0 0 3.5px var(--border, #c9ced6);
}

.color-swatch.checked {
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
}
</style>
