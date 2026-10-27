import type { Ctx } from "@milkdown/kit/ctx";
import { editorViewCtx } from "@milkdown/kit/core";
import { bulletListSchema, orderedListSchema, listItemSchema } from "@milkdown/kit/preset/commonmark";
import { wrapIn } from "@milkdown/kit/prose/commands";
import { TextSelection } from "@milkdown/kit/prose/state";

/**
 * 列表按钮的完整语义（Crepe 自带按钮只会「包一层」）：
 * - 不在列表里 → 包成对应列表
 * - 已在同类型列表 → 整块取消，变成普通段落
 * - 在另一种列表里 → 原地换类型，并重排有序编号
 *
 * 用整块处理而不是只动当前行：工具栏按钮的预期就是「这一块整体切换」。
 * 嵌套列表只处理光标所在的这一层，子列表保持原样。
 */
export function toggleList(ctx: Ctx, kind: "bullet" | "ordered"): boolean {
  const view = ctx.get(editorViewCtx);
  const bullet = bulletListSchema.type(ctx);
  const ordered = orderedListSchema.type(ctx);
  const itemType = listItemSchema.type(ctx);
  const target = kind === "ordered" ? ordered : bullet;

  const { state } = view;
  const { $from } = state.selection;

  let depth = -1;
  for (let d = $from.depth; d > 0; d -= 1) {
    const node = $from.node(d);
    if (node.type === bullet || node.type === ordered) {
      depth = d;
      break;
    }
  }

  // 1) 普通段落：包成列表
  if (depth < 0) {
    return wrapIn(target)(state, (tr) => view.dispatch(tr));
  }

  const list = $from.node(depth);
  const listPos = $from.before(depth);

  // 2) 同类型：整块取消（把每个 item 的内容提升到列表位置）
  if (list.type === target) {
    const lifted: any[] = [];
    list.forEach((item) => {
      item.forEach((child) => lifted.push(child));
    });
    const tr = state.tr.replaceWith(listPos, listPos + list.nodeSize, lifted);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(listPos + 1, tr.doc.content.size))));
    view.dispatch(tr.scrollIntoView());
    return true;
  }

  // 3) 异类型：换父节点类型 + 重写每个 item 的 listType / label
  const tr = state.tr.setNodeMarkup(listPos, target, {
    order: 1,
    spread: list.attrs.spread ?? false,
  });

  const newList = tr.doc.nodeAt(listPos);
  if (newList) {
    let index = 0;
    newList.forEach((item, offset) => {
      index += 1;
      const itemPos = listPos + 1 + offset;
      const attrs = {
        ...item.attrs,
        listType: kind === "ordered" ? "ordered" : "bullet",
        label: kind === "ordered" ? `${index}.` : "•",
      };
      tr.setNodeMarkup(itemPos, itemType, attrs);
    });
  }

  view.dispatch(tr.scrollIntoView());
  return true;
}
