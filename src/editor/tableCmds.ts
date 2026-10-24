import { commandsCtx, editorViewCtx } from "@milkdown/core";
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  deleteSelectedCellsCommand,
  selectColCommand,
  selectRowCommand,
  selectTableCommand,
} from "@milkdown/preset-gfm";
import { NodeSelection, TextSelection } from "@milkdown/prose/state";
import { isInTable, selectedRect } from "@milkdown/prose/tables";
import type { EditorView } from "@milkdown/prose/view";
import { getPmCtx } from "./pmCtxRef";

export type TableAlign = "left" | "center" | "right";


export type TableCmd =
  | "rowBefore"
  | "rowAfter"
  | "colBefore"
  | "colAfter"
  | "delRow"
  | "delCol"
  | "delTable";

/**
 * 表格命令必须走 Milkdown 命令层（与 Crepe 自带表格工具条同一条路径），
 * 不能裸调 prosemirror-tables：Crepe 点击单元格后选区是挂在 cell 节点上的
 * NodeSelection，裸命令的 cellAround 在这种选区下找不到单元格，会静默失败。
 */

/** NodeSelection 挂在 cell 上时，把光标落回 cell 内的文本位置。 */
function normalizeSelection(view: EditorView) {
  const sel = view.state.selection;
  if (sel instanceof NodeSelection) {
    const role = sel.node.type.spec.tableRole;
    if (role === "cell" || role === "header_cell") {
      const $inside = view.state.doc.resolve(sel.from + 1);
      view.dispatch(view.state.tr.setSelection(TextSelection.near($inside, 1)));
    }
  }
}

/**
 * 删掉整个表格，原位保留一个空段落（空行），光标落入其中。
 * 用于删除最后一行/最后一列：表格即将塌掉时，退化为「删除表格 + 留空行」。
 */
function deleteTableLeaveBlank(view: EditorView): boolean {
  const { state } = view;
  const { $from } = state.selection;
  let depth = $from.depth;
  let tablePos = -1;
  let tableSize = 0;
  while (depth > 0) {
    const node = $from.node(depth);
    if (node.type.name === "table" || node.type.spec.tableRole === "table") {
      tablePos = $from.before(depth);
      tableSize = node.nodeSize;
      break;
    }
    depth -= 1;
  }
  if (tablePos < 0) return false;
  const tr = state.tr;
  tr.replaceWith(tablePos, tablePos + tableSize, state.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.near(tr.doc.resolve(tablePos + 1), 1));
  view.dispatch(tr);
  return true;
}

export function runTableCmd(name: TableCmd): boolean {
  const ctx = getPmCtx();
  if (!ctx) return false;
  const view = ctx.get(editorViewCtx);
  if (!view) return false;

  normalizeSelection(view);
  if (!isInTable(view.state)) return false;

  const commands = ctx.get(commandsCtx);
  const rect = selectedRect(view.state);

  switch (name) {
    // 插入行/列直接以当前选区为基准（与 Crepe 的 addRow 行为一致，含对齐属性继承）
    case "rowBefore":
      return commands.call(addRowBeforeCommand.key);
    case "rowAfter":
      return commands.call(addRowAfterCommand.key);
    case "colBefore":
      return commands.call(addColBeforeCommand.key);
    case "colAfter":
      return commands.call(addColAfterCommand.key);
    // 删行/删列先精确选中该行/列，再删除（避免多选单元格时误删范围扩大）。
    // 注意：selectRow/selectColCommand 内部是 Boolean(dispatch(...))，
    // dispatch 无返回值所以恒为 false，不能拿它做失败短路。
    // GFM 表头行（第 0 行）不可删：删掉后下一数据行会被顶成表头。
    case "delRow":
      if (rect.top === 0) return false;
      // 删的是最后一行数据：表格将塌掉 → 直接删除表格，原位留一个空行
      if (rect.map.height <= 2) return deleteTableLeaveBlank(view);
      commands.call(selectRowCommand.key, { index: rect.top });
      return commands.call(deleteSelectedCellsCommand.key);
    case "delCol":
      // 删的是最后一列：表格将塌掉 → 直接删除表格，原位留一个空行
      if (rect.map.width <= 1) return deleteTableLeaveBlank(view);
      commands.call(selectColCommand.key, { index: rect.left });
      return commands.call(deleteSelectedCellsCommand.key);
    case "delTable":
      commands.call(selectTableCommand.key);
      return commands.call(deleteSelectedCellsCommand.key);
  }
}

/**
 * 在行列边界处插入：index 在范围内时选中该列/行执行 before 命令；
 * index 越界（=末尾之后）时选中最后一列/行执行 after 命令。
 * 效果等同语雀在边线上点「+」。
 *
 * index 一律是表格坐标：行含表头（表头 = 0，工具条不会传 0），列与
 * 第一行单元格一一对应。milkdown 表格 DOM 没有 thead，所有 tr 都在
 * tbody 里，表头行只是用 th 单元格，不能靠 thead/tbody 区分。
 */
export function insertAtBoundary(direction: "col" | "row", index: number): boolean {
  const ctx = getPmCtx();
  if (!ctx) return false;
  const view = ctx.get(editorViewCtx);
  if (!view) return false;
  const block = view.dom.querySelector(".milkdown-table-block");
  if (!block) return false;

  const commands = ctx.get(commandsCtx);

  if (direction === "col") {
    const firstRow = block.querySelector("tr");
    const width = firstRow ? firstRow.children.length : 0;
    if (!width) return false;
    // selectColCommand 返回值恒为 false（内部 Boolean(dispatch(...))），不能短路
    if (index < width) {
      commands.call(selectColCommand.key, { index });
      return commands.call(addColBeforeCommand.key);
    }
    commands.call(selectColCommand.key, { index: width - 1 });
    return commands.call(addColAfterCommand.key);
  }

  const allRows = block.querySelectorAll("tr");
  const height = allRows.length;
  if (!height) return false;
  const target = Math.max(1, Math.min(index, height - 1));
  if (index >= height) {
    commands.call(selectRowCommand.key, { index: height - 1 });
    return commands.call(addRowAfterCommand.key);
  }
  commands.call(selectRowCommand.key, { index: target });
  return commands.call(addRowBeforeCommand.key);
}

/* ---------------- 语雀式：列对齐 / 列宽自适应 ---------------- */

/**
 * 设置当前列的文本对齐（左/中/右）。
 * GFM 只支持按列对齐（`:---:` / `:---:` / `---:`），所以语义上以列为单位：
 * 选中任意单元格 → 该列所有单元格一起对齐，保存后可跨设备保留。
 *
 * 不用 milkdown 的 setAlign 命令（依赖 CellSelection，合成事件下容易静默失败），
 * 直接用 TableMap 定位整列单元格后 setNodeMarkup，行为确定。
 */
export function setTableAlign(align: TableAlign): boolean {
  const ctx = getPmCtx();
  if (!ctx) return false;
  const view = ctx.get(editorViewCtx);
  if (!view) return false;
  normalizeSelection(view);
  if (!isInTable(view.state)) return false;

  const rect = selectedRect(view.state);
  const tablePos = rect.tableStart - 1;
  const table = view.state.doc.nodeAt(tablePos);
  if (!table) return false;

  const seen = new Set<number>();
  let tr = view.state.tr;
  let changed = false;
  for (let row = 0; row < rect.map.height; row += 1) {
    const pos = rect.map.positionAt(row, rect.left, table);
    if (seen.has(pos)) continue; // 跨行合并单元格只改一次
    seen.add(pos);
    const cell = table.nodeAt(pos);
    if (!cell) continue;
    if (cell.attrs.alignment === align) continue;
    tr = tr.setNodeMarkup(tablePos + 1 + pos, undefined, { ...cell.attrs, alignment: align });
    changed = true;
  }
  if (changed) view.dispatch(tr);
  return true;
}

/** 读取光标所在列的对齐方式（用于工具条高亮）。 */
export function currentTableAlign(): TableAlign | "" {
  const ctx = getPmCtx();
  if (!ctx) return "";
  const view = ctx.get(editorViewCtx);
  if (!view || !isInTable(view.state)) return "";
  const rect = selectedRect(view.state);
  const table = view.state.doc.nodeAt(rect.tableStart - 1);
  const headerCell = table?.firstChild?.maybeChild(rect.left);
  const align = headerCell?.attrs.alignment;
  return align === "left" || align === "center" || align === "right" ? align : "";
}

/**
 * 列宽自适应：清掉所有单元格的 colwidth，让浏览器按内容分配宽度。
 * （Markdown 不保存列宽，重开文档本来就按内容自适应，这里只是把当前会话
 * 里手动拖出来的固定宽度一并清掉。）
 */
export function autoFitTable(): boolean {
  const ctx = getPmCtx();
  if (!ctx) return false;
  const view = ctx.get(editorViewCtx);
  if (!view) return false;
  normalizeSelection(view);
  if (!isInTable(view.state)) return false;
  const rect = selectedRect(view.state);
  const tablePos = rect.tableStart - 1;
  const table = view.state.doc.nodeAt(tablePos);
  if (!table) return false;

  let tr = view.state.tr;
  let changed = false;
  view.state.doc.nodesBetween(tablePos, tablePos + table.nodeSize, (node, pos) => {
    const isCell = node.type.name === "table_cell" || node.type.name === "table_header";
    if (isCell && node.attrs.colwidth) {
      tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, colwidth: null });
      changed = true;
    }
    return true;
  });
  if (changed) view.dispatch(tr);
  return true;
}
