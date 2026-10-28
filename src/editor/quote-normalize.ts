import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";

/**
 * 引用不允许套娃：出现 blockquote 里再嵌 blockquote 时，
 * 把内层引用拆成外层的内容（保留文字与内部块结构）。
 *
 * 触发路径可能有三条：手打 `> `、斜杠菜单「引用」、粘贴带引用的内容，
 * 所以放在 appendTransaction 里统一兜底，而不是只堵命令。
 * 只在真的出现嵌套时返回新事务，平时零开销。
 */
export const noNestedQuote = $prose(
  () =>
    new Plugin({
      key: new PluginKey("md-no-nested-quote"),
      appendTransaction(trs, _old, next) {
        if (!trs.some((tr) => tr.docChanged)) return null;

        // 收集「父级是引用」的引用节点（任意层级），从后往前拆
        const nested: { pos: number; node: any }[] = [];
        next.doc.descendants((node, pos, parent) => {
          if (node.type.name !== "blockquote") return true;
          if (!parent) return true;
          let insideQuote = false;
          // parent 只给直接父级：直接父级是引用，或祖先是引用
          if (parent.type.name === "blockquote") insideQuote = true;
          else {
            const $pos = next.doc.resolve(pos);
            for (let depth = $pos.depth; depth > 0; depth -= 1) {
              if ($pos.node(depth).type.name === "blockquote") {
                insideQuote = true;
                break;
              }
            }
          }
          if (insideQuote) nested.push({ pos, node });
          return true;
        });

        if (!nested.length) return null;

        let tr = next.tr;
        for (const item of nested.reverse()) {
          tr = tr.replaceWith(item.pos, item.pos + item.node.nodeSize, item.node.content);
        }
        return tr;
      },
    }),
);
