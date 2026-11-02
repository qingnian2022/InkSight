import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { Node as PMNode } from "@milkdown/kit/prose/model";

/**
 * 相邻有序列表自动合并。
 *
 * 背景：从语雀 / 飞书 / 浏览器渲染页复制列表时，剪贴板 HTML 常把每个 <li> 各包成一个
 * 独立的 <ol>。导入后就是 N 个「单元素有序列表」，每项都从 1 开始编号，看起来全是 1。
 *
 * 这里在每次文档变更后扫描相邻的 ordered_list：
 *   - 两者都是 ordered_list
 *   - 后一个的起始序号 <= 前一个的起始序号 + 项数（即「重新从 1 开始」或本来就连续）
 * 满足就合并成一个列表，保留前者的 order，编号自然连续。
 *
 * 明确跳号的分隔（如 1-3 之后从 5 开始）不合并，避免破坏作者意图。
 */
const listNormalizeKey = new PluginKey("inksight-list-normalize");

function findMerge(state: EditorState): Transaction | null {
  const tr = state.tr;
  let didMerge = false;

  const walk = (parent: PMNode, base: number) => {
    if (didMerge) return;

    const children: { node: PMNode; pos: number }[] = [];
    let offset = 0;
    parent.forEach((child) => {
      children.push({ node: child, pos: base + offset });
      offset += child.nodeSize;
    });

    for (let i = 0; i < children.length - 1; i++) {
      const a = children[i];
      const b = children[i + 1];
      if (a.node.type.name !== "ordered_list" || b.node.type.name !== "ordered_list") continue;

      const aOrder = Number(a.node.attrs.order ?? 1);
      const bOrder = Number(b.node.attrs.order ?? 1);
      const aCount = a.node.childCount;
      // 后一个从更大的序号开始，是有意的分段 → 不合并
      if (bOrder > aOrder + aCount) continue;

      const merged = a.node.type.create(a.node.attrs, a.node.content.append(b.node.content));
      tr.replaceWith(a.pos, b.pos + b.node.nodeSize, merged);
      didMerge = true;
      return;
    }

    // 递归处理嵌套容器（引用、列表项内部等）
    for (const child of children) {
      if (child.node.childCount > 0) walk(child.node, child.pos + 1);
      if (didMerge) return;
    }
  };

  walk(state.doc, 0);
  return didMerge ? tr : null;
}

export const listNormalizePlugin = $prose(
  () =>
    new Plugin({
      key: listNormalizeKey,
      appendTransaction(transactions, _oldState, newState) {
        if (!transactions.some((t) => t.docChanged)) return null;
        // 单次只修一处，PM 会为返回的事务再次调用本钩子，直到没有可合并的
        return findMerge(newState);
      },
    }),
);
