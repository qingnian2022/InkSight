<script setup lang="ts">
import { computed } from "vue";
import { setModule, WORK_MODULES } from "../store";
import Icon from "./Icon.vue";

/**
 * 非笔记模块的主区占位。
 * 不用编辑器的空状态 —— 那会让人以为「这里有文档可以写」，
 * 而实际这个模块还没接数据。只说清楚边界，给一条回到笔记的路。
 */
const props = defineProps<{ module: string }>();

const meta = computed(
  () => WORK_MODULES.find((m) => m.key === props.module) ?? WORK_MODULES[0],
);
</script>

<template>
  <section class="module-stage" :aria-label="meta.label">
    <Icon :name="meta.icon" :size="22" />
    <p>{{ meta.label }}还没接入</p>
    <span>{{ meta.blurb }}</span>
    <button class="mp-back" @click="setModule('notes')">回到笔记</button>
  </section>
</template>
