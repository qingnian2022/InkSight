<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { confirmPromptState, finishConfirm } from "../ui/confirmPrompt";

const okBtn = ref<HTMLButtonElement | null>(null);

watch(
  () => confirmPromptState.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    okBtn.value?.focus();
  },
);

function onKey(e: KeyboardEvent) {
  if (!confirmPromptState.open) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    finishConfirm(false);
  } else if (e.key === "Enter") {
    e.preventDefault();
    finishConfirm(true);
  }
}

onMounted(() => document.addEventListener("keydown", onKey, true));
onBeforeUnmount(() => document.removeEventListener("keydown", onKey, true));
</script>

<template>
  <div v-if="confirmPromptState.open" class="cp-mask" @mousedown.self="finishConfirm(false)">
    <div
      class="cp-box"
      role="dialog"
      aria-modal="true"
      :aria-label="confirmPromptState.title"
    >
      <p class="cp-title">{{ confirmPromptState.title }}</p>
      <p class="cp-message">{{ confirmPromptState.message }}</p>
      <p v-if="confirmPromptState.detail" class="cp-detail">{{ confirmPromptState.detail }}</p>

      <div class="cp-actions">
        <button class="cp-btn" type="button" @click="finishConfirm(false)">
          {{ confirmPromptState.cancelText }}
        </button>
        <button
          ref="okBtn"
          class="cp-btn primary"
          :class="{ danger: confirmPromptState.danger }"
          type="button"
          @click="finishConfirm(true)"
        >
          {{ confirmPromptState.okText }}
        </button>
      </div>
    </div>
  </div>
</template>
