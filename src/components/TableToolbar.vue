<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { EditorView } from "@milkdown/prose/view";
import {
  autoFitTable,
  currentTableAlign,
  insertAtBoundary,
  runTableCmd,
  setTableAlign,
  type TableAlign,
} from "../editor/tableCmds";
import Icon from "./Icon.vue";

/**
 * 语雀式表格交互层：
 * - 光标进入表格时，表格上方出现悬浮工具条（行列增删 / 删除表格）
 * - 列间、行间出现「+」插入点，点一下就地插入
 * 离开表格 300ms 后整体隐藏；命令走 prosemirror-tables。
 */
const props = defineProps<{ view: EditorView | null }>();

const show = ref(false);
const pos = ref({ top: 0, left: 0, plusColTop: 0, plusRowLeft: 0 });
const plusCols = ref<{ left: number; index: number }[]>([]);
/** 当前列的对齐方式（工具条高亮用） */
const align = ref<TableAlign | "">("");
const plusRows = ref<{ top: number; index: number }[]>([]);
let hideTimer: number | undefined;
let refreshTimer: number | undefined;
let scrollEl: HTMLElement | null = null;

type Area = { top: number; bottom: number; left: number; right: number };

/**
 * 富文本**真正可见**的区域：工具条与「+」都是 fixed，必须夹在这里面。
 * 注意 `.milkdown` 顶部有一条 sticky 的编辑器工具栏（高约 42–44px），
 * 正文是从它下面穿过去的——直接拿 `.milkdown` 的 rect 会把加号画到那条工具栏上。
 */
function editorArea(block: HTMLElement): Area {
  const scroller = block.closest<HTMLElement>(".milkdown");
  const rect = (scroller ?? document.documentElement).getBoundingClientRect();
  const bar =
    scroller?.querySelector<HTMLElement>(".milkdown-top-bar") ??
    block.closest(".rich-editor")?.querySelector<HTMLElement>(".milkdown-top-bar");
  // sticky 时 bar.bottom 贴住 rect.top + 高度；滚走时 bar.bottom 会小于 rect.top，
  // 用 max 兼容两种状态，都不需要写死 44。
  const top = bar
    ? Math.max(rect.top, Math.min(bar.getBoundingClientRect().bottom, rect.bottom))
    : rect.top;
  return { top, bottom: rect.bottom, left: rect.left, right: rect.right };
}

/** 表格是否还与可视区相交：整块滚出视野时不该留下悬空的工具条 / 加号 */
function blockVisible(block: HTMLElement): boolean {
  const area = editorArea(block);
  const rect = block.getBoundingClientRect();
  return rect.bottom > area.top + 4 && rect.top < area.bottom - 4;
}

function anchorBlock(): HTMLElement | null {
  const sel = window.getSelection();
  const node = sel?.anchorNode;
  if (!node) return null;
  const el = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
  const block = el?.closest<HTMLElement>(".milkdown-table-block") ?? null;
  if (!block || !props.view?.dom.contains(block)) return null;
  return block;
}

function place(block: HTMLElement) {
  // 全部用视口坐标 + position: fixed，滚动 / 宿主换算都不会出错；
  // 但固定定位不受任何祖先 overflow 裁剪，所以坐标必须自己夹进富文本可视区。
  if (!blockVisible(block)) {
    show.value = false;
    return;
  }

  const area = editorArea(block);
  const blockRect = block.getBoundingClientRect();
  const toolbarH = 38;
  const rawLeft = blockRect.left + blockRect.width / 2;
  const tableTop = blockRect.top;
  const tableLeft = blockRect.left;

  const clampY = (y: number, h: number) =>
    Math.min(Math.max(y, area.top + 8), Math.max(area.top + 8, area.bottom - h - 8));
  const clampX = (x: number, w: number) =>
    Math.min(Math.max(x, area.left + 4), Math.max(area.left + 4, area.right - w - 4));

  // 工具条悬在表格上沿外 12px（原来 6px，会和骑在上边框上的「+」叠 4px）
  const wantTop = tableTop - toolbarH - 12;
  const toolbarTop = clampY(wantTop, toolbarH);
  // 表格离可视区顶太近时工具条会被压下来，正好落在表头「+」那一行上：
  // 这时不再画列「+」，插入列的动作交给工具条自己的左列/右列按钮
  const toolbarPushedDown = toolbarTop > wantTop + 0.5;

  pos.value = {
    top: toolbarTop,
    left: Math.max(130, Math.min(rawLeft, window.innerWidth - 130)),
    // 列插入点的纵向位置：表头滚出视口时贴在可视区上沿，不跑到工具栏上面
    plusColTop: clampY(tableTop - 10, 20),
    // 行插入点的横向位置：表格左边距外 26px，但不越出可视区左沿
    plusRowLeft: clampX(tableLeft - 26, 20),
  };

  // 列边界 →「+」插入点（坐标相对视口；index 为表格坐标）
  // 注意：milkdown 表格 DOM 没有 thead，表头行也在 tbody 里（用 th 单元格），
  // 必须取第一行 tr 的单元格来定位列。
  const firstRow = block.querySelector("tr");
  const cells = firstRow ? Array.from(firstRow.children) : [];
  const colPos: { left: number; index: number }[] = [];
  // 表头行滚出视野、或工具条被可视区顶边压下来时，不再提供列插入点，
  // 避免一列「+」浮在正文/工具栏上面
  const headerVisible =
    tableTop >= area.top + 2 && tableTop <= area.bottom - 2;
  if (headerVisible && !toolbarPushedDown) {
    cells.forEach((cell, i) => {
      if (i === 0) return; // 第一列左缘是表格左边界，不提供
      colPos.push({ left: clampX(cell.getBoundingClientRect().left - 10, 20), index: i });
    });
    const lastCol = cells[cells.length - 1]?.getBoundingClientRect();
    if (lastCol) colPos.push({ left: clampX(lastCol.right - 10, 20), index: cells.length });
  }
  plusCols.value = colPos;

  // 行边界 →「+」插入点：所有 tr 都在 tbody（无 thead），跳过表头上方
  // （index 0）不提供；第 i 行的上边界即「在第 i 行前插入」（i >= 1）
  const allRows = block.querySelectorAll("tbody tr");
  const rowPos: { top: number; index: number }[] = [];
  allRows.forEach((row, i) => {
    if (i === 0) return; // 表头上方不提供插入点
    const top = row.getBoundingClientRect().top;
    // 只保留落在可视区内的行边界，其余滚出视野
    if (top < area.top + 2 || top > area.bottom - 2) return;
    rowPos.push({ top: clampY(top - 14, 20), index: i });
  });
  const lastRow = allRows[allRows.length - 1]?.getBoundingClientRect();
  if (lastRow) {
    const bottom = lastRow.bottom;
    if (bottom >= area.top + 2 && bottom <= area.bottom - 2) {
      rowPos.push({ top: clampY(bottom - 14, 20), index: allRows.length });
    }
  }
  plusRows.value = rowPos;

  align.value = currentTableAlign();
}

function update() {
  if (!props.view) return;
  const block = anchorBlock();
  if (block && blockVisible(block)) {
    window.clearTimeout(hideTimer);
    if (!show.value) {
      show.value = true;
      void nextTick(() => place(block));
    } else {
      place(block);
    }
    watchScroll(block);
  } else if (show.value) {
    window.clearTimeout(hideTimer);
    // 隐藏前再确认一次：合成事件/输入法可能触发中间态的 selectionchange
    hideTimer = window.setTimeout(() => {
      if (!anchorBlock()) show.value = false;
    }, 300);
  }
}

/** 表格在滚动容器里，滚动时跟随移动 */
function watchScroll(block: HTMLElement) {
  const scroller = block.closest<HTMLElement>(".milkdown");
  if (scroller && scroller !== scrollEl) {
    scrollEl?.removeEventListener("scroll", onScroll);
    scrollEl = scroller;
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
  }
}

function onScroll() {
  if (!show.value) return;
  const block = anchorBlock();
  if (block) place(block);
}

function run(cmd: Parameters<typeof runTableCmd>[0]) {
  runTableCmd(cmd);
  requestAnimationFrame(update);
}

function applyAlign(next: TableAlign) {
  setTableAlign(next);
  requestAnimationFrame(update);
}

function fitColumns() {
  autoFitTable();
  requestAnimationFrame(update);
}

function runBoundary(direction: "col" | "row", index: number) {
  insertAtBoundary(direction, index);
  requestAnimationFrame(update);
}

onMounted(() => {
  document.addEventListener("selectionchange", update);
  window.addEventListener("resize", update);
  // PM 更新文档会重建节点、重映射选区，selectionchange 可能给出中间态；
  // 低频轮询让显示状态自愈（只读 selection，成本可忽略）
  refreshTimer = window.setInterval(update, 400);
});

onBeforeUnmount(() => {
  document.removeEventListener("selectionchange", update);
  window.removeEventListener("resize", update);
  scrollEl?.removeEventListener("scroll", onScroll);
  window.clearInterval(refreshTimer);
  window.clearTimeout(hideTimer);
});
</script>

<template>
  <div v-if="show && view" class="tbl-layer">
    <div class="tbl-toolbar" role="toolbar" aria-label="表格工具" :style="{ top: `${pos.top}px`, left: `${pos.left}px` }">
      <button class="tbl-btn" title="在上方插入行" @mousedown.prevent @click="run('rowBefore')">
        <Icon name="plus" :size="13" />上行
      </button>
      <button class="tbl-btn" title="在下方插入行" @mousedown.prevent @click="run('rowAfter')">
        <Icon name="plus" :size="13" />下行
      </button>
      <span class="tbl-sep" />
      <button class="tbl-btn" title="在左侧插入列" @mousedown.prevent @click="run('colBefore')">
        <Icon name="plus" :size="13" />左列
      </button>
      <button class="tbl-btn" title="在右侧插入列" @mousedown.prevent @click="run('colAfter')">
        <Icon name="plus" :size="13" />右列
      </button>
      <span class="tbl-sep" />
      <button class="tbl-btn danger" title="删除当前行" @mousedown.prevent @click="run('delRow')">
        删行
      </button>
      <button class="tbl-btn danger" title="删除当前列" @mousedown.prevent @click="run('delCol')">
        删列
      </button>
      <span class="tbl-sep" />
      <button
        class="tbl-btn"
        :class="{ active: align === 'left' }"
        title="当前列左对齐（保存为 :---）"
        @mousedown.prevent
        @click="applyAlign('left')"
      >
        左
      </button>
      <button
        class="tbl-btn"
        :class="{ active: align === 'center' }"
        title="当前列居中（保存为 :---:）"
        @mousedown.prevent
        @click="applyAlign('center')"
      >
        中
      </button>
      <button
        class="tbl-btn"
        :class="{ active: align === 'right' }"
        title="当前列右对齐（保存为 ---:）"
        @mousedown.prevent
        @click="applyAlign('right')"
      >
        右
      </button>
      <span class="tbl-sep" />
      <button class="tbl-btn" title="列宽自适应内容" @mousedown.prevent @click="fitColumns">
        <Icon name="refresh" :size="12" />自适应
      </button>
      <span class="tbl-sep" />
      <button class="tbl-btn danger" title="删除整个表格" @mousedown.prevent @click="run('delTable')">
        <Icon name="close" :size="12" />表格
      </button>
    </div>

    <button
      v-for="p in plusCols"
      :key="`c${p.index}`"
      class="tbl-plus"
      :style="{ left: `${p.left}px`, top: `${pos.plusColTop}px` }"
      :title="`在此处插入列`"
      @mousedown.prevent
      @click="runBoundary('col', p.index)"
    >
      +
    </button>

    <button
      v-for="p in plusRows"
      :key="`r${p.index}`"
      class="tbl-plus"
      :style="{ top: `${p.top}px`, left: `${pos.plusRowLeft}px` }"
      title="在此处插入行"
      @mousedown.prevent
      @click="runBoundary('row', p.index)"
    >
      +
    </button>
  </div>
</template>
