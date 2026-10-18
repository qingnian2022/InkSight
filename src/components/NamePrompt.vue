<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { finishNamePrompt, namePromptState } from "../ui/namePrompt";

const input = ref<HTMLInputElement | null>(null);

watch(
  () => namePromptState.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    const el = input.value;
    if (!el) return;
    el.focus();
    // 选中去掉扩展名的主名，方便直接改名
    const dot = namePromptState.value.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : namePromptState.value.length);
  },
);

function confirm() {
  const value = namePromptState.value.trim();
  if (!value) return;
  finishNamePrompt(value);
}
</script>

<template>
  <div v-if="namePromptState.open" class="np-mask" @mousedown.self="finishNamePrompt(null)">
    <form class="np-box" @submit.prevent="confirm">
      <p class="np-title">{{ namePromptState.title }}</p>
      <input
        ref="input"
        v-model="namePromptState.value"
        class="np-input"
        type="text"
        maxlength="80"
        spellcheck="false"
        @keydown.esc.prevent="finishNamePrompt(null)"
      />
      <div class="np-actions">
        <button class="np-btn" type="button" @click="finishNamePrompt(null)">取消</button>
        <button class="np-btn primary" type="submit" :disabled="!namePromptState.value.trim()">
          {{ namePromptState.confirmText }}
        </button>
      </div>
    </form>
  </div>
</template>
