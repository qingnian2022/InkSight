<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { confirmPromptState, finishConfirm } from "../ui/confirmPrompt";
import { rememberFocus, trapFocus } from "../ui/dialogFocus";

const okBtn = ref<HTMLButtonElement | null>(null);
const boxEl = ref<HTMLElement | null>(null);
let releaseTrap: (() => void) | null = null;
let restoreFocus: (() => void) | null = null;

watch(
  () => confirmPromptState.open,
  async (open) => {
    if (!open) {
      releaseTrap?.();
      releaseTrap = null;
      restoreFocus?.();
      restoreFocus = null;
      return;
    }
    await nextTick();
    okBtn.value?.focus();
    if (boxEl.value) {
      restoreFocus = rememberFocus();
      releaseTrap = trapFocus(boxEl.value);
    }
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
      ref="boxEl"
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
