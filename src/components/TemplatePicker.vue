<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { openConfirm } from "../ui/confirmPrompt";
import { showToast } from "../ui/toast";
import { state } from "../store";
import {
  deleteCustomTemplate,
  finishTemplatePicker,
  templatePickerState,
  type DocTemplate,
} from "../ui/templatePicker";

const busyId = ref<string | null>(null);
const errorText = ref("");

function select(tpl: DocTemplate) {
  templatePickerState.selectedId = tpl.id;
}

/** 删除自定义模板（内置模板没有删除入口） */
async function remove(tpl: DocTemplate) {
  const ok = await openConfirm({
    title: "删除模板",
    message: `删除模板「${tpl.name}」？`,
    detail: "模板文件会从 .templates 目录移除，此操作不可撤销。",
    okText: "删除",
    danger: true,
  });
  if (!ok) return;
  busyId.value = tpl.id;
  errorText.value = "";
  try {
    await deleteCustomTemplate(state.root, tpl);
    showToast(`已删除模板「${tpl.name}」`);
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : String(err);
    showToast(`删除模板失败：${errorText.value}`, "error");
  } finally {
    busyId.value = null;
  }
}

function create() {
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
    create();
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
        <div
          v-for="tpl in templatePickerState.items"
          :key="tpl.id"
          class="tpl-card"
          role="button"
          tabindex="0"
          :class="{ active: templatePickerState.selectedId === tpl.id, busy: busyId === tpl.id }"
          @click="select(tpl)"
          @dblclick="create"
        >
          <span class="tpl-name">
            {{ tpl.name }}
            <span v-if="tpl.custom" class="tpl-custom">自定义</span>
          </span>
          <span class="tpl-desc">{{ tpl.desc }}</span>
          <span
            v-if="tpl.custom"
            class="tpl-del"
            role="button"
            title="删除模板"
            aria-label="删除模板"
            @pointerdown.stop.prevent
            @click.stop.prevent="remove(tpl)"
          >
            ×
          </span>
        </div>
      </div>

      <p v-if="errorText" class="tpl-error">{{ errorText }}</p>

      <p class="tpl-hint">
        自定义模板：目录树右键文档 →「存为模板」，或把 .md 放进知识库
        <b>.templates/</b>；变量 <b>&#123;&#123;date&#125;&#125;</b> /
        <b>&#123;&#123;date+1&#125;&#125;</b> /
        <b>&#123;&#123;date:YYYY年M月D日&#125;&#125;</b> /
        <b>&#123;&#123;time&#125;&#125;</b> /
        <b>&#123;&#123;weekday&#125;&#125;</b> /
        <b>&#123;&#123;title&#125;&#125;</b>
      </p>

      <label class="tpl-default">
        <input v-model="templatePickerState.asDefault" type="checkbox" />
        <span>设为默认模板（下次 + 直接使用，右键可重选）</span>
      </label>

      <div class="tpl-actions">
        <button class="tpl-btn" @click="cancel">取消</button>
        <button class="tpl-btn primary" @click="create">创建</button>
      </div>
    </div>
  </div>
</template>
