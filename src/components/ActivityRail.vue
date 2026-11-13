<script setup lang="ts">
import { setModule, state, WORK_MODULES, type WorkModule } from "../store";
import { ensureSession } from "../terminal";
import Icon from "./Icon.vue";

/**
 * 活动栏：常驻最左一列，只决定第二列（侧栏）显示什么。
 * 它不参与折叠 —— Ctrl+\ 只收起侧栏，这列图标始终在，保证任何模块随时一键可达。
 */
function pick(key: WorkModule) {
  setModule(key);
  // 同模块重复点击不会触发 watch，这里补一次「保证有会话」；不碰笔记页 Dock 的开关
  if (key === "terminal") ensureSession();
}
</script>

<template>
  <nav class="act-rail" aria-label="工作台模块">
    <button
      v-for="m in WORK_MODULES"
      :key="m.key"
      class="act-btn"
      :class="{ on: state.module === m.key }"
      :aria-pressed="state.module === m.key"
      :title="`${m.label} · ${m.hint}`"
      :aria-label="m.label"
      @click="pick(m.key)"
    >
      <Icon :name="m.icon" :size="17" />
    </button>

    <span class="act-spacer" />

    <span class="act-sep" />

    <button
      class="act-btn"
      :aria-pressed="state.railCollapsed"
      :title="state.railCollapsed ? '展开侧栏 Ctrl+\\' : '收起侧栏 Ctrl+\\'"
      aria-label="收起或展开侧栏"
      @click="state.railCollapsed = !state.railCollapsed"
    >
      <Icon name="panel" :size="17" />
    </button>
  </nav>
</template>
