import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

/**
 * 标题折叠（Tier A：只影响视图，不改文件）。
 * 点标题左侧的三角收起该标题下的内容，直到遇到同级或更高层级的标题。
 * 文档内容变化后位置会失效，所以编辑时自动全部展开。
 */

const foldKey = new PluginKey<Set<number>>("md-heading-fold");

interface FoldMeta {
  pos: number;
}

function computeDecorations(state: EditorState, folded: Set<number>): DecorationSet {
  const decos: Decoration[] = [];
  const doc = state.doc;
  const top: { pos: number; node: any }[] = [];
  doc.forEach((node, offset) => top.push({ pos: offset, node }));

  top.forEach((item, index) => {
    const level = item.node.attrs?.level;
    if (item.node.type.name !== "heading" || typeof level !== "number") return;

    const end = item.pos + item.node.nodeSize;
    // 找下一个层级 <= 当前标题的标题
    let stop = doc.content.size;
    for (let i = index + 1; i < top.length; i += 1) {
      const next = top[i];
      const nextLevel = next.node.attrs?.level;
      if (next.node.type.name === "heading" && typeof nextLevel === "number" && nextLevel <= level) {
        stop = next.pos;
        break;
      }
    }
    const foldable = stop > end;
    const isFolded = folded.has(item.pos) && foldable;

    if (foldable) {
      decos.push(
        Decoration.widget(item.pos + 1, (view) => {
          const btn = document.createElement("span");
          btn.className = `md-fold-btn${isFolded ? " folded" : ""}`;
          btn.setAttribute("contenteditable", "false");
          btn.setAttribute("title", isFolded ? "展开" : "折叠");
          btn.addEventListener("mousedown", (event) => {
            event.preventDefault();
            event.stopPropagation();
            view.dispatch(view.state.tr.setMeta(foldKey, { pos: item.pos } satisfies FoldMeta));
          });
          return btn;
        }, { side: -1 }),
      );
    }

    if (isFolded) {
      for (let i = index + 1; i < top.length; i += 1) {
        const node = top[i];
        if (node.pos >= stop) break;
        decos.push(
          Decoration.node(node.pos, node.pos + node.node.nodeSize, { class: "md-fold-hidden" }),
        );
      }
    }
  });

  return DecorationSet.create(doc, decos);
}

/** 斜杠菜单 / 快捷键用：折叠或展开光标所在的标题。 */
export function toggleFoldAtCursor(view: { state: EditorState; dispatch: (tr: unknown) => void }): boolean {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "heading") continue;
    const pos = $from.before(depth);
    view.dispatch(view.state.tr.setMeta(foldKey, { pos } satisfies FoldMeta));
    return true;
  }
  return false;
}

export const headingFoldPlugin = $prose(

  () =>
    new Plugin<Set<number>>({
      key: foldKey,
      state: {
        init: () => new Set<number>(),
        apply(tr, value) {
          const meta = tr.getMeta(foldKey) as FoldMeta | undefined;
          if (meta) {
            const next = new Set(value);
            if (next.has(meta.pos)) next.delete(meta.pos);
            else next.add(meta.pos);
            return next;
          }
          // 内容变动后位置可能失效，直接全部展开，避免折错地方
          if (tr.docChanged) return new Set<number>();
          return value;
        },
      },
      props: {
        decorations: (state) => computeDecorations(state, foldKey.getState(state) ?? new Set()),
        // Mod-Alt-F：折叠 / 展开光标所在标题
        handleKeyDown: (view, event) => {
          if (!event.altKey || !(event.ctrlKey || event.metaKey)) return false;
          if (event.key.toLowerCase() !== "f") return false;
          const { $from } = view.state.selection;
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            if ($from.node(depth).type.name !== "heading") continue;
            const pos = $from.before(depth);
            view.dispatch(view.state.tr.setMeta(foldKey, { pos } satisfies FoldMeta));
            event.preventDefault();
            return true;
          }
          return false;
        },
      },
    }),
);
