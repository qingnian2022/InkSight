<script setup lang="ts">
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { EditorView } from "@codemirror/view";
import { createEditorState, editableCompartment } from "../editor/setup";
import { setView } from "../editor/viewRef";
import { activeTab, finishTabReload, newDoc, state } from "../store";
import Icon from "./Icon.vue";

// Crepe 会捎带 @codemirror/language-data 的全部语言包，按需加载以免拖慢首屏
const RichEditor = defineAsyncComponent(() => import("./RichEditor.vue"));

const host = ref<HTMLElement | null>(null);
let view: EditorView | null = null;

function enterEditing() {
  if (state.readonly) state.readonly = false;
}

function teardown() {
  setView(null);
  view?.destroy();
  view = null;
}

async function syncEditor() {
  if (!state.activePath || state.editorMode !== "source") {
    teardown();
    return;
  }

  const tab = activeTab.value;
  if (!tab) return;

  await nextTick();
  if (!host.value) return;

  if (!view) {
    view = new EditorView({
      state: createEditorState(tab.content),
      parent: host.value,
    });
    setView(view);
  } else {
    view.setState(createEditorState(tab.content));
  }
  view.focus();
}

function remountForHotReload() {
  teardown();
  void nextTick().then(syncEditor);
}

onMounted(() => {
  void syncEditor();
  window.addEventListener("md-rust:remount-editor", remountForHotReload);
});

onBeforeUnmount(() => {
  window.removeEventListener("md-rust:remount-editor", remountForHotReload);
  teardown();
});

watch([() => state.activePath, () => state.tabReloadToken], async () => {
  await syncEditor();
  // 源码模式没有 RichEditor 的 mount 回调，重载收尾放在这里
  const path = state.tabReloading?.path;
  if (path && path === state.activePath) finishTabReload(path);
});

watch(
  () => state.editorMode,
  async (mode) => {
    if (mode === "source") {
      await nextTick();
      await syncEditor();
    } else {
      teardown();
    }
  },
);

watch(
  () => state.readonly,
  (readonly) => {
    view?.dispatch({
      effects: editableCompartment.reconfigure(EditorView.editable.of(!readonly)),
    });
  },
);
</script>

<template>
  <div class="editor-wrap">
    <RichEditor v-if="state.activePath && state.editorMode === 'rich'" />

    <div
      v-else-if="state.activePath"
      ref="host"
      class="editor-host"
      @mousedown="enterEditing"
    />

    <div v-else class="empty-state">
      <div class="empty-mark">
        <Icon name="file" :size="22" />
      </div>
      <h2>还没有打开文档</h2>
      <p>
        从左侧目录选择一篇 Markdown，或新建一篇。正文会直接渲染，光标停在哪一行，哪一行才显示
        Markdown 标记。
      </p>
      <button class="primary-btn" @click="() => newDoc()">新建文档</button>
      <p class="empty-hint">纯文本存储 · 不锁定格式 · 可用 Git 管理</p>
    </div>

    <!-- 加载遮罩：打开大文件与远端重载共用一套样式 -->
    <div
      v-if="(state.tabReloading && state.tabReloading.path === state.activePath) || state.fileLoading"
      class="reload-overlay"
    >
      <div class="reload-card">
        <div class="reload-spinner" />
        <div class="reload-title">
          {{ state.tabReloading ? "正在载入远端版本" : "正在打开文档" }}
        </div>
        <div class="reload-sub">
          {{ state.tabReloading?.name ?? state.fileLoading?.name }}
        </div>
        <div class="reload-bar"><span /></div>
      </div>
    </div>
  </div>
</template>
