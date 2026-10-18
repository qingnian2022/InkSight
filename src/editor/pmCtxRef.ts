import type { Crepe } from "@milkdown/crepe";

/**
 * Milkdown 编辑器的 Ctx 引用。
 * 表格命令走 Milkdown 命令层（commandsCtx.call），必须拿到编辑器自己的 Ctx，
 * 裸的 ProseMirror view 不够用。
 */
type ActionFn = Parameters<Crepe["editor"]["action"]>[0];
export type MilkdownCtx = Parameters<ActionFn>[0];

let ctx: MilkdownCtx | null = null;

export function setPmCtx(c: MilkdownCtx | null) {
  ctx = c;
}

export function getPmCtx(): MilkdownCtx | null {
  return ctx;
}
