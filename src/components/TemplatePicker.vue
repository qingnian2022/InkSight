<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import {
  finishTemplatePicker,
  templatePickerState,
  type DocTemplate,
} from "../ui/templatePicker";

function select(tpl: DocTemplate) {
  templatePickerState.selectedId = tpl.id;
}

function confirm() {
  const tpl = templatePickerState.items.find((t) => t.id === templatePickerState.selectedId) ?? null;
  finishTemplatePicker(tpl);
}

function cancel() {
  finishTemplatePicker(null);
}

function onKey(e: KeyboardEvent) {
  if (!templatePickerState.open) return;
  if (e.key === "Escape") {
    e.preventDefault();
    cancel();
  } else if (e.key === "Enter") {
    e.preventDefault();
    confirm();
  }
}

onMounted(() => document.addEventListener("keydown", onKey));
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
</script>

<template>
  <div v-if="templatePickerState.open" class="tpl-overlay" @pointerdown.self="cancel">
    <div class="tpl-modal" role="dialog" aria-label="新建文档">
      <p class="tpl-title">新建文档</p>

      <div class="tpl-grid">
        <button
          v-for="tpl in templatePickerState.items"
          :key="tpl.id"
          class="tpl-card"
          :class="{ active: templatePickerState.selectedId === tpl.id }"
          @click="select(tpl)"
          @dblclick="confirm"
        >
          <span class="tpl-name">
            {{ tpl.name }}
            <span v-if="tpl.custom" class="tpl-custom">自定义</span>
          </span>
          <span class="tpl-desc">{{ tpl.desc }}</span>
        </button>
      </div>

      <p class="tpl-hint">
        自定义模板：把 .md 文件放进知识库的
        <b>.templates/</b> 目录；支持占位符
        <b>&#123;&#123;date&#125;&#125;</b> / <b>&#123;&#123;title&#125;&#125;</b>
      </p>

      <label class="tpl-default">
        <input v-model="templatePickerState.asDefault" type="checkbox" />
        <span>设为默认模板（下次 + 直接使用，右键可重选）</span>
      </label>

      <div class="tpl-actions">
        <button class="tpl-btn" @click="cancel">取消</button>
        <button class="tpl-btn primary" @click="confirm">创建</button>
      </div>
    </div>
  </div>
</template>
