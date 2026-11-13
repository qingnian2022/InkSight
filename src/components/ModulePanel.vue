<script setup lang="ts">
import { computed } from "vue";
import { WORK_MODULES } from "../store";

/**
 * 非笔记模块的侧栏占位：只说这一栏将来放什么，不放假的控件。
 * 主要说明放在主区的 ModuleStage 上，这里保持一行注脚的量级，
 * 避免左右两列重复同一句话。
 */
const props = defineProps<{ module: string }>();

const meta = computed(
  () => WORK_MODULES.find((m) => m.key === props.module) ?? WORK_MODULES[0],
);
</script>

<template>
  <aside class="sidebar module-panel" :aria-label="meta.label">
    <div class="rail-head">
      <span class="mp-title">{{ meta.label }}</span>
      <span class="rail-head-spacer" />
      <span class="mp-tag">未接入</span>
    </div>

    <p class="mp-note">{{ meta.blurb }}</p>

    <div class="rail-footer">{{ meta.hint }}</div>
  </aside>
</template>
