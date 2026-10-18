<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Crepe } from "@milkdown/crepe";
import { lineNumbers } from "@codemirror/view";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { activeTab, markDirty, state } from "../store";

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
  if (!host.value || !tab || !state.activePath) return;

  const path = tab.path;
  const instance = new Crepe({
    root: host.value,
    defaultValue: tab.content,
    featureConfigs: {
      [Crepe.Feature.CodeMirror]: {
        // 代码块内显示行号，和源码模式保持一致
        extensions: [lineNumbers()],
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
}

onMounted(mount);

onBeforeUnmount(() => {
  // 让还在 await create 的那次 mount 失效，否则会在已卸载的 DOM 上留一个编辑器
  seq += 1;
  void teardown();
});

watch(() => state.activePath, mount);

watch(
  () => state.readonly,
  (readonly) => crepe?.setReadonly(readonly),
);
</script>

<template>
  <div ref="host" class="rich-editor" data-rich-editor />
</template>
