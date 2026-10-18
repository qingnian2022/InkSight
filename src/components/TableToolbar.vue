<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { EditorView } from "@milkdown/prose/view";
import { insertAtBoundary, runTableCmd } from "../editor/tableCmds";
import Icon from "./Icon.vue";

/**
 * 语雀式表格交互层：
 * - 光标进入表格时，表格上方出现悬浮工具条（行列增删 / 删除表格）
 * - 列间、行间出现「+」插入点，点一下就地插入
 * 离开表格 300ms 后整体隐藏；命令走 prosemirror-tables。
 */
const props = defineProps<{ view: EditorView | null }>();

const show = ref(false);
const pos = ref({ top: 0, left: 0, tableLeft: 0, tableTop: 0 });
const plusCols = ref<{ left: number; index: number }[]>([]);
const plusRows = ref<{ top: number; index: number }[]>([]);
let hideTimer: number | undefined;
let refreshTimer: number | undefined;
let scrollEl: HTMLElement | null = null;

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
  // 全部用视口坐标 + position: fixed，滚动 / 宿主换算都不会出错
  const blockRect = block.getBoundingClientRect();
  const toolbarH = 38;
  const rawLeft = blockRect.left + blockRect.width / 2;
  const tableTop = blockRect.top;
  const tableLeft = blockRect.left;

  pos.value = {
    top: Math.max(150, tableTop - toolbarH - 6),
    left: Math.max(130, Math.min(rawLeft, window.innerWidth - 130)),
    tableLeft,
    tableTop,
  };

  // 列边界 →「+」插入点（坐标相对视口；index 为表格坐标）
  // 注意：milkdown 表格 DOM 没有 thead，表头行也在 tbody 里（用 th 单元格），
  // 必须取第一行 tr 的单元格来定位列。
  const firstRow = block.querySelector("tr");
  const cells = firstRow ? Array.from(firstRow.children) : [];
  const colPos: { left: number; index: number }[] = [];
  cells.forEach((cell, i) => {
    if (i === 0) return; // 第一列左缘是表格左边界，不提供
    colPos.push({ left: cell.getBoundingClientRect().left, index: i });
  });
  const lastCol = cells[cells.length - 1]?.getBoundingClientRect();
  if (lastCol) colPos.push({ left: lastCol.right, index: cells.length });
  plusCols.value = colPos;

  // 行边界 →「+」插入点：所有 tr 都在 tbody（无 thead），跳过表头上方
  // （index 0）不提供；第 i 行的上边界即「在第 i 行前插入」（i >= 1）
  const allRows = block.querySelectorAll("tbody tr");
  const rowPos: { top: number; index: number }[] = [];
  allRows.forEach((row, i) => {
    if (i === 0) return; // 表头上方不提供插入点
    rowPos.push({ top: row.getBoundingClientRect().top, index: i });
  });
  const lastRow = allRows[allRows.length - 1]?.getBoundingClientRect();
  if (lastRow) rowPos.push({ top: lastRow.bottom, index: allRows.length });
  plusRows.value = rowPos;
}

function update() {
  if (!props.view) return;
  const block = anchorBlock();
  if (block) {
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
      <button class="tbl-btn danger" title="删除整个表格" @mousedown.prevent @click="run('delTable')">
        <Icon name="close" :size="12" />表格
      </button>
    </div>

    <button
      v-for="p in plusCols"
      :key="`c${p.index}`"
      class="tbl-plus"
      :style="{ left: `${p.left - 10}px`, top: `${pos.tableTop - 10}px` }"
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
      :style="{ top: `${p.top - 14}px`, left: `${pos.tableLeft - 26}px` }"
      title="在此处插入行"
      @mousedown.prevent
      @click="runBoundary('row', p.index)"
    >
      +
    </button>
  </div>
</template>
