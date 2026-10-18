<script setup lang="ts">
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { EditorView } from "@codemirror/view";
import { createEditorState, editableCompartment } from "../editor/setup";
import { setView } from "../editor/viewRef";
import { activeTab, newDoc, pickVault, state } from "../store";
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

watch(() => state.activePath, syncEditor);

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
      <h2>{{ state.root ? "还没有打开文档" : "选一个文件夹开始" }}</h2>
      <p>
        {{
          state.root
            ? "从左侧目录选择一篇 Markdown，或新建一篇。正文会直接渲染，光标停在哪一行，哪一行才显示 Markdown 标记。"
            : "md-rust 不建立自己的数据库：选中的文件夹就是知识库，文件就是数据。可以随时用 Git 或别的编辑器打开。"
        }}
      </p>
      <button class="primary-btn" @click="state.root ? newDoc() : pickVault()">
        {{ state.root ? "新建文档" : "选择知识库文件夹" }}
      </button>
      <p class="empty-hint">纯文本存储 · 不锁定格式 · 可用 Git 管理</p>
    </div>
  </div>
</template>
