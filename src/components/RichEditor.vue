<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { EditorView } from "@milkdown/prose/view";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { codeTheme } from "../editor/code-theme";
import { buildColorTopBarItems, closeColorPalette } from "../editor/color-commands";
import { coloredTextSchema, mergeInlineColorHtml } from "../editor/inline-html";
import { normalizeEmphasis } from "../editor/normalize-emphasis";
import { attachToolbarOverflow } from "../editor/toolbarOverflow";
import { setPmCtx } from "../editor/pmCtxRef";
import { setPmView } from "../editor/pmViewRef";
import { activeTab, isUntitledPath, markDirty, state } from "../store";
import { openImageLightbox } from "../ui/imageLightbox";
import ColorPalette from "./ColorPalette.vue";
import TableToolbar from "./TableToolbar.vue";

/**
 * 把文档里的图片地址转成 webview 可加载的 asset:// 地址。
 * - http(s) / data / blob：原样返回
 * - 绝对路径（盘符 / 根开头）：直接转
 * - 相对路径（assets/xxx、../img/a.png）：以当前文档所在目录为基准解析
 *   （Markdown 相对路径以文档文件为基准，不是知识库根）
 */
function resolveImageUrl(url: string): string {
  if (!url || /^(https?|data|blob):/i.test(url)) return url;
  const tab = activeTab.value;
  if (!tab || isUntitledPath(tab.path)) return url;

  let abs = url;
  if (!/^[a-zA-Z]:[\\/]/.test(url) && !url.startsWith("/") && !url.startsWith("\\")) {
    const parts = tab.path.split(/[\\/]/);
    parts.pop(); // 去掉文件名，得到文档所在目录
    for (const seg of url.split(/[\\/]/)) {
      if (seg === "." || seg === "") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    abs = parts.join("\\");
  }
  return convertFileSrc(abs);
}

/**
 * 语雀式块级编辑：Milkdown Crepe。
 * - 顶部固定工具栏（TopBar）；选中文字的气泡工具栏（Toolbar）已关闭
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
let detachOverflow: (() => void) | null = null;

/** 点击正文图片 → 语雀式暗色放大预览 */
function onHostClick(e: MouseEvent) {
  const el = e.target as HTMLElement | null;
  const img = el?.closest?.("img") as HTMLImageElement | null;
  if (!img || !host.value?.contains(img)) return;
  e.preventDefault();
  openImageLightbox(img.currentSrc || img.src, img.alt || "");
}

async function teardown() {
  detachOverflow?.();
  detachOverflow = null;
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
          // 「文字颜色」按钮（语雀式：A 直接染色 + ▾ 弹色板，自制弹层）
          // 语雀式布局：重排默认分组——
          //   标题下拉 | 加粗 斜体 删除线 A ▾ | 列表×3 | 链接 图片 表格 | 行内代码 代码块 公式 | 引用 分割线
          buildTopBar: (builder) => {
            const formatting = builder.getGroup("formatting").group;
            // 行内代码从文本样式组挪到代码块一组（语雀把代码类收在块级区域）
            const codeIndex = formatting.items.findIndex((item) => item.key === "code");
            if (codeIndex >= 0) {
              const codeItem = formatting.items.splice(codeIndex, 1)[0];
              builder.getGroup("block").group.items.unshift(codeItem);
            }
            // 颜色双按钮放文本样式组末尾（加粗 / 斜体 / 删除线之后，语雀同款位置）
            formatting.items.push(...buildColorTopBarItems());
          },
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
      [Crepe.Feature.ImageBlock]: {
        inlineUploadButton: "上传",
        inlineConfirmButton: "确定",
        inlineUploadPlaceholderText: "或粘贴图片链接",
        blockUploadButton: "上传图片",
        blockConfirmButton: "确定",
        blockCaptionPlaceholderText: "写图注",
        blockUploadPlaceholderText: "或粘贴图片链接",
        // 本地图片（相对/绝对路径）转 asset:// 显示；http(s) 原样
        proxyDomURL: resolveImageUrl,
      },
      [Crepe.Feature.CodeMirror]: {
        // 配色换成项目自己的低饱和色板（不显示行号）
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
      // 未列出的 Crepe 功能默认开启，必须显式关掉气泡工具栏
      [Crepe.Feature.Toolbar]: false,
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
  // normalizeEmphasis 先跑：把同步/导入里的全角星号、`**加粗**` 反引号包法救回来
  instance.editor.use(normalizeEmphasis).use(mergeInlineColorHtml).use(coloredTextSchema);

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

  // 工具栏渐进收纳：宽度不够时把靠后的命令收进 ⋯ 菜单
  const inner = host.value?.querySelector<HTMLElement>(".top-bar-inner");
  if (inner) {
    detachOverflow?.();
    detachOverflow = attachToolbarOverflow(inner, {
      itemSelector: ".top-bar-item",
      dividerSelector: ".top-bar-divider",
      keepFirst: 1,
      gap: 2,
    });
  }
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

watch(() => state.activePath, () => {
  closeColorPalette();
  void mount();
});

watch(
  () => state.readonly,
  (readonly) => crepe?.setReadonly(readonly),
);
</script>

<template>
  <div class="rich-editor" @click="onHostClick">
    <div ref="host" class="rich-editor-body" data-rich-editor />
    <ColorPalette />
    <TableToolbar :view="pmView" />
  </div>
</template>
