<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { errorText, importAsset } from "../api";
import {
  doRedo,
  doUndo,
  formatCommands,
  insertBlock,
  setHeading,
  setParagraph,
  toggleLinePrefix,
} from "../editor/viewRef";
import { state } from "../store";
import Icon from "./Icon.vue";

const menuOpen = ref(false);
const pickerRef = ref<HTMLElement | null>(null);

const blockLabels: Record<string, string> = {
  paragraph: "正文",
  h1: "标题 1",
  h2: "标题 2",
  h3: "标题 3",
  h4: "标题 4",
  h5: "标题 5",
  h6: "标题 6",
  quote: "引用",
  code: "代码块",
  bullet: "无序列表",
  ordered: "有序列表",
  task: "任务列表",
};

const blockMenu = [
  { value: "paragraph", label: "正文" },
  { value: "h1", label: "标题 1" },
  { value: "h2", label: "标题 2" },
  { value: "h3", label: "标题 3" },
  { value: "quote", label: "引用" },
  { value: "code", label: "代码块" },
];

const currentBlockLabel = computed(() => blockLabels[state.blockType] ?? "正文");
const isMark = (name: string) => state.activeMarks.includes(name);

function applyBlock(item: { value: string }) {
  menuOpen.value = false;
  if (item.value === "paragraph") {
    setParagraph();
    return;
  }
  if (item.value.startsWith("h")) {
    setHeading(Number(item.value.slice(1)));
    return;
  }
  if (item.value === "quote") {
    toggleLinePrefix("> ");
    return;
  }
  if (item.value === "code") {
    insertBlock("```\n\n```", 4);
  }
}

async function insertImage() {
  if (!state.root || !state.activePath) return;
  const picked = await open({
    multiple: false,
    title: "选择图片",
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
  });
  if (typeof picked !== "string") return;
  try {
    const relative = await importAsset(state.root, state.activePath, picked);
    const snippet = `![](${relative})`;
    insertBlock(snippet, snippet.length);
  } catch (err) {
    state.error = errorText(err);
  }
}

function onDocumentClick(event: MouseEvent) {
  if (!menuOpen.value) return;
  if (pickerRef.value && !pickerRef.value.contains(event.target as Node)) {
    menuOpen.value = false;
  }
}

onMounted(() => document.addEventListener("mousedown", onDocumentClick));
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocumentClick));
</script>

<template>
  <div class="md-toolbar" role="toolbar" aria-label="格式工具栏">
    <div class="md-toolbar-left">
      <div ref="pickerRef" class="block-picker">
        <button
          class="md-tb-item md-tb-text"
          :aria-expanded="menuOpen"
          title="段落样式"
          @click="menuOpen = !menuOpen"
        >
          <span class="md-tb-label">{{ currentBlockLabel }}</span>
          <Icon name="chevron" :size="11" />
        </button>

        <div v-if="menuOpen" class="block-menu">
          <button
            v-for="item in blockMenu"
            :key="item.value"
            class="block-menu-item"
            :class="[`is-${item.value}`, { active: state.blockType === item.value }]"
            @click="applyBlock(item)"
          >
            {{ item.label }}
          </button>
        </div>
      </div>

      <span class="md-tb-divider" />

      <button
        class="md-tb-item"
        :class="{ active: isMark('strong') }"
        title="加粗 Ctrl+B"
        aria-label="加粗"
        @click="formatCommands.bold"
      >
        <Icon name="bold" :size="20" />
      </button>
      <button
        class="md-tb-item"
        :class="{ active: isMark('emphasis') }"
        title="斜体 Ctrl+I"
        aria-label="斜体"
        @click="formatCommands.italic"
      >
        <Icon name="italic" :size="20" />
      </button>
      <button
        class="md-tb-item"
        :class="{ active: isMark('strike') }"
        title="删除线"
        aria-label="删除线"
        @click="formatCommands.strike"
      >
        <Icon name="strike" :size="20" />
      </button>
      <button
        class="md-tb-item"
        :class="{ active: isMark('inlineCode') }"
        title="行内代码"
        aria-label="行内代码"
        @click="formatCommands.code"
      >
        <Icon name="code-inline" :size="20" />
      </button>
      <button class="md-tb-item" title="链接 Ctrl+K" aria-label="链接" @click="formatCommands.link">
        <Icon name="link" :size="20" />
      </button>

      <span class="md-tb-divider" />

      <button
        class="md-tb-item"
        :class="{ active: state.blockType === 'bullet' }"
        title="无序列表"
        aria-label="无序列表"
        @click="formatCommands.ul"
      >
        <Icon name="ul" :size="20" />
      </button>
      <button
        class="md-tb-item"
        :class="{ active: state.blockType === 'ordered' }"
        title="有序列表"
        aria-label="有序列表"
        @click="formatCommands.ol"
      >
        <Icon name="ol" :size="20" />
      </button>
      <button
        class="md-tb-item"
        :class="{ active: state.blockType === 'task' }"
        title="任务列表"
        aria-label="任务列表"
        @click="formatCommands.task"
      >
        <Icon name="task" :size="20" />
      </button>
      <button
        class="md-tb-item"
        :class="{ active: state.blockType === 'quote' }"
        title="引用"
        aria-label="引用"
        @click="formatCommands.quote"
      >
        <Icon name="quote" :size="20" />
      </button>
      <button
        class="md-tb-item"
        :class="{ active: state.blockType === 'code' }"
        title="代码块"
        aria-label="代码块"
        @click="formatCommands.codeBlock"
      >
        <Icon name="code" :size="20" />
      </button>
      <button class="md-tb-item" title="分割线" aria-label="分割线" @click="formatCommands.rule">
        <Icon name="rule" :size="20" />
      </button>

      <span class="md-tb-divider" />

      <button
        class="md-tb-item"
        title="插入图片（复制到知识库 assets）"
        aria-label="插入图片"
        @click="insertImage"
      >
        <Icon name="image" :size="20" />
      </button>
    </div>

    <div class="md-toolbar-right">
      <button class="md-tb-item" title="撤销 Ctrl+Z" aria-label="撤销" @click="doUndo">
        <Icon name="undo" :size="20" />
      </button>
      <button class="md-tb-item" title="重做 Ctrl+Shift+Z" aria-label="重做" @click="doRedo">
        <Icon name="redo" :size="20" />
      </button>
    </div>
  </div>
</template>
