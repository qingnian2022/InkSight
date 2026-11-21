<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import {
  clearSelection,
  computeGrid,
  deleteColsAt,
  deleteRowsAt,
  fillDown,
  fillRight,
  insertColsAt,
  insertRowsAt,
  isNumeric,
  isSelected,
  normalize,
  parseTsv,
  rowsToTsv,
  saveSheet,
  saveWidths,
  selectionTsv,
  setAnchor,
  selectedShape,
  sortByColumn,
  setCursor,
  sheetStore,
} from "../sheet";
import { notify } from "../store";
import Icon from "./Icon.vue";

const grid = ref<HTMLElement | null>(null);
const computedGrid = computed(() => computeGrid(sheetStore.rows));
const editing = ref("");

function cellKey(row: number, col: number) {
  return row + ":" + col;
}

/** 公式格：失焦显示结果，聚焦显示原文（和 Excel 一致） */
function cellValue(row: number, col: number) {
  if (editing.value === cellKey(row, col)) return sheetStore.rows[row]?.[col] ?? "";
  return computedGrid.value[row]?.[col] ?? "";
}

function onCellFocus(event: FocusEvent, row: number, col: number) {
  setCursor(row, col);
  editing.value = cellKey(row, col);
  const el = event.target as HTMLInputElement;
  void nextTick(() => {
    el.value = sheetStore.rows[row]?.[col] ?? "";
  });
}

function onCellBlur() {
  editing.value = "";
}

function cellAt(row: number, col: number) {
  return grid.value?.querySelector<HTMLInputElement>(
    `input[data-r="${row}"][data-c="${col}"]`,
  );
}

function focusCell(row: number, col: number) {
  setCursor(row, col);
  void nextTick(() => {
    const el = cellAt(row, col);
    el?.focus();
    el?.select();
  });
}

function onCellDown(event: MouseEvent, row: number, col: number) {
  if (event.shiftKey) {
    // 从锚点拉出一片：不重置锚点，只移动当前格
    setCursor(row, col);
    return;
  }
  setAnchor(row, col);
  setCursor(row, col);
}

function hasRange() {
  return sheetStore.cursorRow !== sheetStore.anchorRow || sheetStore.cursorCol !== sheetStore.anchorCol;
}

function onCellKey(event: KeyboardEvent) {
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === "c" && hasRange()) {
    event.preventDefault();
    void navigator.clipboard.writeText(selectionTsv()).then(() => notify("已复制选区")).catch(() => {});
    return;
  }
  if (mod && event.key.toLowerCase() === "d" && hasRange()) {
    event.preventDefault();
    fillDown();
    return;
  }
  if ((event.key === "Delete" || event.key === "Backspace") && hasRange()) {
    event.preventDefault();
    clearSelection();
  }
}

function onKey(event: KeyboardEvent, row: number, col: number) {
  const rows = sheetStore.rows;
  const width = rows[row]?.length ?? 1;
  if (event.key === "Enter") {
    event.preventDefault();
    if (row + 1 >= rows.length) insertRowsAt(rows.length, 1);
    focusCell(row + 1, col);
  } else if (event.key === "Tab") {
    event.preventDefault();
    const nextCol = col + 1 < width ? col + 1 : 0;
    const nextRow = col + 1 < width ? row : Math.min(row + 1, rows.length - 1);
    focusCell(nextRow, nextCol);
  } else if (event.key === "ArrowUp" && row > 0) {
    event.preventDefault();
    focusCell(row - 1, col);
  } else if (event.key === "ArrowDown" && row + 1 < rows.length) {
    event.preventDefault();
    focusCell(row + 1, col);
  } else if (event.key === "Escape") {
    sheetStore.open = false;
  }
}

/** 从 Excel 复制的整块 TSV：从当前单元格开始铺开 */
function onPaste(event: ClipboardEvent, row: number, col: number) {
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (!text.includes("\t") && !text.includes("\n")) return;
  event.preventDefault();

  const block = parseTsv(text);
  const next = sheetStore.rows.map((line) => [...line]);
  const width = Math.max(
    next[0]?.length ?? 1,
    col + Math.max(...block.map((line) => line.length)),
  );
  while (next.length < row + block.length) next.push(new Array(width).fill(""));
  next.forEach((line) => {
    while (line.length < width) line.push("");
  });
  block.forEach((line, ri) => {
    line.forEach((value, ci) => {
      if (next[row + ri]) next[row + ri][col + ci] = value;
    });
  });
  sheetStore.rows = normalize(next);
  focusCell(row, col);
}

/* ---------- 列宽拖拽 ---------- */

let resizing: { col: number; startX: number; startWidth: number } | null = null;

function onResizeMove(event: PointerEvent) {
  if (!resizing) return;
  const width = Math.min(520, Math.max(56, resizing.startWidth + event.clientX - resizing.startX));
  sheetStore.widths[resizing.col] = Math.round(width);
}

function endResize() {
  resizing = null;
  window.removeEventListener("pointermove", onResizeMove);
  saveWidths();
}

function startResize(event: PointerEvent, col: number) {
  event.preventDefault();
  event.stopPropagation();
  resizing = { col, startX: event.clientX, startWidth: sheetStore.widths[col] ?? 132 };
  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", endResize, { once: true });
}

async function copyTsv() {
  try {
    await navigator.clipboard.writeText(rowsToTsv(normalize(sheetStore.rows)));
    notify("已复制为 TSV");
  } catch (err) {
    notify(String(err));
  }
}
</script>

<template>
  <div v-if="sheetStore.open" class="sheet-mask" @pointerdown.self="sheetStore.open = false">
    <div class="sheet-card" role="dialog" aria-modal="true" :aria-label="sheetStore.name">
      <header class="sheet-head">
        <div class="sheet-title">
          <span class="sheet-name">{{ sheetStore.name }}</span>
          <span class="sheet-meta">
            {{ sheetStore.rows.length }} 行 · {{ sheetStore.rows[0]?.length ?? 0 }} 列
          </span>
        </div>
        <div class="sheet-actions">
          <button class="sheet-btn" @click="insertRowsAt(selectedShape().top, selectedShape().rows)">
            插入 {{ selectedShape().rows }} 行
          </button>
          <button class="sheet-btn" @click="insertColsAt(selectedShape().left, selectedShape().cols)">
            插入 {{ selectedShape().cols }} 列
          </button>
          <button class="sheet-btn" @click="deleteRowsAt(selectedShape().top, selectedShape().rows)">
            删除 {{ selectedShape().rows }} 行
          </button>
          <button class="sheet-btn" @click="deleteColsAt(selectedShape().left, selectedShape().cols)">
            删除 {{ selectedShape().cols }} 列
          </button>
          <button class="sheet-btn" @click="fillDown">填充 ↓</button>
          <button class="sheet-btn" @click="fillRight">填充 →</button>
          <button class="sheet-btn" @click="copyTsv">复制 TSV</button>
          <button class="sheet-btn" @click="sortByColumn(sheetStore.cursorCol, true)">升序</button>
          <button class="sheet-btn" @click="sortByColumn(sheetStore.cursorCol, false)">降序</button>
          <button class="tool-btn" title="关闭" aria-label="关闭" @click="sheetStore.open = false">
            <Icon name="close" :size="14" />
          </button>
        </div>
      </header>

      <div ref="grid" class="sheet-grid">
        <table>
          <colgroup>
            <col style="width: 34px" />
            <col
              v-for="(width, c) in sheetStore.widths"
              :key="c"
              :style="{ width: width + 'px' }"
            />
          </colgroup>
          <tbody>
            <tr v-for="(row, r) in sheetStore.rows" :key="r" :class="{ head: r === 0 }">
              <th class="sheet-rowno">{{ r + 1 }}</th>
              <td
                v-for="(cell, c) in row"
                :key="c"
                :class="{ sel: isSelected(r, c) }"
                @mousedown="onCellDown($event, r, c)"
              >
                <input
                  :data-r="r"
                  :data-c="c"
                  :value="cellValue(r, c)"
                  :class="{ num: isNumeric(cell) }"
                  @focus="onCellFocus($event, r, c)"
                  @blur="onCellBlur"
                  @input="sheetStore.rows[r][c] = ($event.target as HTMLInputElement).value"
                  @keydown="onKey($event, r, c); onCellKey($event)"
                  @paste="onPaste($event, r, c)"
                />
                <span
                  v-if="r === 0"
                  class="col-grip"
                  title="拖动调整列宽"
                  @pointerdown="startResize($event, c)"
                  @dblclick.stop="sheetStore.widths[c] = 132; saveWidths()"
                ></span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer class="sheet-foot">
        <span class="sheet-hint">
          从 Excel 粘贴可分列；Enter 下移、Tab 右移；拖表头右边缘调列宽；公式如 =SUM(B2:B4)
        </span>
        <button class="ghost-btn" @click="sheetStore.open = false">取消</button>
        <button class="primary-btn sheet-save" :disabled="sheetStore.saving" @click="saveSheet">
          {{ sheetStore.saving ? "保存中…" : sheetStore.mode === "inline" ? "应用到文档" : "保存 CSV" }}
        </button>
      </footer>
    </div>
  </div>
</template>
