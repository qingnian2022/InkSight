<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { keepLocalForConflict, state, useRemoteForConflict } from "../store";
import { rememberFocus, trapFocus } from "../ui/dialogFocus";

/**
 * 远端更新与本地未保存改动冲突时的确认框。
 * 关闭（点遮罩 / Esc / 取消）等价于「先保留本地」，不会自动覆盖。
 */
const cardEl = ref<HTMLElement | null>(null);
const primaryBtn = ref<HTMLButtonElement | null>(null);
let releaseTrap: (() => void) | null = null;
let restoreFocus: (() => void) | null = null;

function keepLocal() {
  keepLocalForConflict();
}

watch(
  () => state.syncConflict,
  async (conflict) => {
    if (!conflict) {
      releaseTrap?.();
      releaseTrap = null;
      restoreFocus?.();
      restoreFocus = null;
      return;
    }
    await nextTick();
    primaryBtn.value?.focus();
    if (cardEl.value) {
      restoreFocus = rememberFocus();
      releaseTrap = trapFocus(cardEl.value);
    }
  },
);

function onKeydown(event: KeyboardEvent) {
  if (!state.syncConflict) return;
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  keepLocal();
}

document.addEventListener("keydown", onKeydown, true);
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown, true);
  releaseTrap?.();
});
</script>

<template>
  <Transition name="fade">
    <div v-if="state.syncConflict" class="conflict-mask" @pointerdown.self="keepLocal">
      <div
        ref="cardEl"
        class="conflict-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
      >
        <div id="conflict-title" class="conflict-title">远端版本已更新</div>
        <div class="conflict-body">
          {{ state.syncConflict.name }} 在远端有新的修改，本地还有未保存的内容。选择如何继续：
        </div>

        <button class="conflict-option primary" @click="useRemoteForConflict()">
          <span class="conflict-option-title">使用远端版本</span>
          <span class="conflict-option-sub">丢弃本地未保存改动，重新载入编辑器</span>
        </button>

        <button class="conflict-option" @click="keepLocal">
          <span class="conflict-option-title">先保留本地</span>
          <span class="conflict-option-sub">本次不同步该文档，下次拉取再提示</span>
        </button>

        <div class="conflict-actions">
          <button class="conflict-btn" @click="keepLocal">取消</button>
          <button ref="primaryBtn" class="conflict-btn primary" @click="useRemoteForConflict()">
            使用远端版本
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
