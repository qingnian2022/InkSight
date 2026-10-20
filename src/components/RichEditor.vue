<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/core";
import { lineNumbers } from "@codemirror/view";
import type { EditorView } from "@milkdown/prose/view";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { codeTheme } from "../editor/code-theme";
import { coloredTextSchema, mergeInlineColorHtml } from "../editor/inline-html";
import { setPmCtx } from "../editor/pmCtxRef";
import { setPmView } from "../editor/pmViewRef";
import { activeTab, markDirty, state } from "../store";
import TableToolbar from "./TableToolbar.vue";
import WidthPicker from "./WidthPicker.vue";

/**
 * 语雀式块级编辑：Milkdown Crepe。
 * - 顶部固定工具栏（TopBar）、选中文字的气泡工具栏（Toolbar）
 * - 块左侧拖拽手柄 + 「/」唤起插入菜单（BlockEdit）
 * - 存储仍是 Markdown 文本：进 Markdown、出 Markdown，store 不用改
 *
 * 与源码模式的差别只在渲染层，而保存时会被序列化器重排，所以两种模式
 * 可以在同一篇文档上来回切，但不要指望 rich 模式保持字节原样。
 */

const host = ref<HTMLElement | null>(null);
const pmView = shallowRef<EditorView | null>(null);
let crepe: Crepe | null = null;
let boundPath = "";
let seq = 0;
// 只有真的动过键盘才写回，避免「切进来看看」就把全文重排一遍
let edited = false;

async function teardown() {
  if (!crepe) return;
  const old = crepe;
  const path = boundPath;
  const touched = edited;
  crepe = null;
  boundPath = "";
  edited = false;

  try {
    if (touched && path && state.tabs.some((t) => t.path === path)) {
      markDirty(path, old.getMarkdown());
    }
  } catch {
    /* 尚未 create 完成时不要读内容 */
  }

  await old.destroy();
}

async function mount() {
  const mine = ++seq;
  await teardown();
  if (mine !== seq) return;

  await nextTick();
  const tab = activeTab.value;
  if (!host.value || !tab || !state.activePath) {
    setPmView(null);
    setPmCtx(null);
    pmView.value = null;
    return;
  }

  const path = tab.path;
  const instance = new Crepe({
    root: host.value,
    defaultValue: tab.content,
    featureConfigs: {
      [Crepe.Feature.TopBar]: {
        headingOptions: [
          { label: "正文", level: null },
          { label: "标题 1", level: 1 },
          { label: "标题 2", level: 2 },
          { label: "标题 3", level: 3 },
          { label: "标题 4", level: 4 },
          { label: "标题 5", level: 5 },
          { label: "标题 6", level: 6 },
        ],
      },
      // 「/」插入菜单的中文文案（图标沿用默认）
      [Crepe.Feature.BlockEdit]: {
        textGroup: {
          label: "文本",
          text: { label: "正文" },
          h1: { label: "标题 1" },
          h2: { label: "标题 2" },
          h3: { label: "标题 3" },
          h4: { label: "标题 4" },
          h5: { label: "标题 5" },
          h6: { label: "标题 6" },
          quote: { label: "引用" },
          divider: { label: "分割线" },
        },
        listGroup: {
          label: "列表",
          bulletList: { label: "无序列表" },
          orderedList: { label: "有序列表" },
          taskList: { label: "任务列表" },
        },
        advancedGroup: {
          label: "插入",
          image: { label: "图片" },
          codeBlock: { label: "代码块" },
          table: { label: "表格" },
          math: { label: "公式" },
        },
      },
      [Crepe.Feature.Placeholder]: {
        text: "开始写作，输入 / 唤起插入菜单",
        mode: "block",
      },
      // 选中文字后的气泡工具栏（这些文案是 title / aria-label）
      [Crepe.Feature.Toolbar]: {
        boldLabel: "加粗",
        italicLabel: "斜体",
        strikethroughLabel: "删除线",
        codeLabel: "行内代码",
        linkLabel: "链接",
        latexLabel: "公式",
        aiLabel: "AI",
      },
      [Crepe.Feature.ImageBlock]: {
        inlineUploadButton: "上传",
        inlineConfirmButton: "确定",
        inlineUploadPlaceholderText: "或粘贴图片链接",
        blockUploadButton: "上传图片",
        blockConfirmButton: "确定",
        blockCaptionPlaceholderText: "写图注",
        blockUploadPlaceholderText: "或粘贴图片链接",
      },
      [Crepe.Feature.CodeMirror]: {
        // 代码块内显示行号，配色换成项目自己的低饱和色板
        extensions: [lineNumbers()],
        theme: codeTheme,
        copyText: "复制",
        searchPlaceholder: "搜索语言",
        noResultText: "没有匹配的语言",
        previewLabel: "预览",
        previewLoading: "加载中…",
      },
    },
    features: {
      // 语雀的顶部工具栏；默认关闭，需要显式打开
      [Crepe.Feature.TopBar]: true,
      [Crepe.Feature.BlockEdit]: true,
      [Crepe.Feature.Toolbar]: true,
      [Crepe.Feature.ListItem]: true,
      [Crepe.Feature.Table]: true,
      [Crepe.Feature.CodeMirror]: true,
      [Crepe.Feature.ImageBlock]: true,
      [Crepe.Feature.Latex]: true,
      [Crepe.Feature.Placeholder]: true,
      [Crepe.Feature.Cursor]: true,
      [Crepe.Feature.AI]: false,
      [Crepe.Feature.LinkTooltip]: false,
    },
  });

  // 内联 HTML 彩色文字（<font>/<span style="color:...">）渲染支持
  instance.editor.use(mergeInlineColorHtml).use(coloredTextSchema);

  let ready = false;

  instance.on((listener) => {
    listener.updated(() => {
      // create 期间的初始化 dispatch 不算用户编辑
      if (!ready) return;
      edited = true;
      markDirty(path, instance.getMarkdown());
    });
  });

  await instance.create();
  ready = true;

  if (mine !== seq) {
    await instance.destroy();
    return;
  }

  instance.setReadonly(state.readonly);
  crepe = instance;
  boundPath = path;

  // 把 ProseMirror 视图与 Milkdown Ctx 挂出来，
  // 表格工具条 / 右键表格命令从这里取
  instance.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    pmView.value = view;
    setPmView(view);
    setPmCtx(ctx);
  });
}

onMounted(mount);

onBeforeUnmount(() => {
  // 让还在 await create 的那次 mount 失效，否则会在已卸载的 DOM 上留一个编辑器
  seq += 1;
  setPmView(null);
  setPmCtx(null);
  pmView.value = null;
  void teardown();
});

watch(() => state.activePath, mount);

watch(
  () => state.readonly,
  (readonly) => crepe?.setReadonly(readonly),
);
</script>

<template>
  <div class="rich-editor">
    <div ref="host" class="rich-editor-body" data-rich-editor />
    <TableToolbar :view="pmView" />
    <WidthPicker />
  </div>
</template>
