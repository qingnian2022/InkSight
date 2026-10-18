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
      commands.call(selectRowCommand.key, { index: rect.top });
      return commands.call(deleteSelectedCellsCommand.key);
    case "delCol":
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
