<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { finishNamePrompt, namePromptState } from "../ui/namePrompt";

const input = ref<HTMLInputElement | null>(null);
const isTauri = "__TAURI_INTERNALS__" in window;

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

/** 更改目标文件夹（仅 Tauri 环境显示） */
async function pickFolder() {
  if (!isTauri) return;
  try {
    const picked = await open({ directory: true, multiple: false, title: "选择保存位置" });
    if (typeof picked === "string") namePromptState.folder = picked;
  } catch {
    /* 用户取消或环境不支持，保持原目录 */
  }
}

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
      <p v-if="namePromptState.folder" class="np-sub">
        确认后才会在磁盘上创建文件；取消则继续留在未命名文档。
      </p>
      <div v-if="namePromptState.folder" class="np-folder" :title="namePromptState.folder">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
        <span class="np-folder-path">{{ namePromptState.folder }}</span>
        <button
          v-if="isTauri"
          class="np-folder-chg"
          type="button"
          @click="pickFolder"
        >
          更改
        </button>
      </div>
      <input
        ref="input"
        v-model="namePromptState.value"
        class="np-input"
        type="text"
        maxlength="80"
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        @keydown.esc.prevent="finishNamePrompt(null)"
      />
      <p v-if="namePromptState.folder" class="np-hint">重名自动加序号（未命名 2、未命名 3…）</p>
      <div class="np-actions">
        <button class="np-btn" type="button" @click="finishNamePrompt(null)">取消</button>
        <button class="np-btn primary" type="submit" :disabled="!namePromptState.value.trim()">
          {{ namePromptState.confirmText }}
        </button>
      </div>
    </form>
  </div>
</template>
