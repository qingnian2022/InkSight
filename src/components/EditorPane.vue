<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { EditorView } from "@codemirror/view";
import { createEditorState, renderCompartment } from "../editor/setup";
import { typoraRendering } from "../editor/typora";
import { setView } from "../editor/viewRef";
import { activeTab, newDoc, pickVault, state } from "../store";

const host = ref<HTMLElement | null>(null);
let view: EditorView | null = null;

async function syncEditor() {
  if (!state.activePath) {
    view?.destroy();
    view = null;
    setView(null);
    return;
  }

  await nextTick();
  if (!host.value) return;

  if (!view) {
    view = new EditorView({
      state: createEditorState(activeTab.value?.content ?? ""),
      parent: host.value,
    });
    setView(view);
  } else {
    view.setState(createEditorState(activeTab.value?.content ?? ""));
  }
  view.focus();
}

onMounted(syncEditor);

onBeforeUnmount(() => {
  setView(null);
  view?.destroy();
  view = null;
});

watch(() => state.activePath, syncEditor);

watch(
  () => state.sourceMode,
  (on) => {
    view?.dispatch({
      effects: renderCompartment.reconfigure(on ? [] : typoraRendering),
    });
  },
);
</script>

<template>
  <div v-if="!state.activePath" class="empty-state">
    <h2>{{ state.root ? "还没有打开文档" : "选一个文件夹开始" }}</h2>
    <p>
      {{
        state.root
          ? "从左侧目录选择一篇 Markdown，或新建一篇。所有内容直接读写你磁盘上的 .md 文件。"
          : "md-rust 不建立自己的数据库：选中的文件夹就是知识库，文件就是数据。可以随时用 Git 或别的编辑器打开。"
      }}
    </p>
    <button class="primary-btn" @click="state.root ? newDoc() : pickVault()">
      {{ state.root ? "新建文档" : "选择知识库文件夹" }}
    </button>
  </div>

  <div
    v-else
    ref="host"
    class="editor-host"
    :class="{ 'source-mode': state.sourceMode }"
  />
</template>
