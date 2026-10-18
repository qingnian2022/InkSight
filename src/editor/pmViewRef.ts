import type { EditorView } from "@milkdown/prose/view";

/**
 * 富文本编辑器的 ProseMirror 视图引用。
 * 表格工具条、右键菜单的表格命令都从这里拿视图，不直接依赖 Crepe 实例。
 */
let view: EditorView | null = null;

export function setPmView(v: EditorView | null) {
  view = v;
}

export function getPmView(): EditorView | null {
  return view;
}
