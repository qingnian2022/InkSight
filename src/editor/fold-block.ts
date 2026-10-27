import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { wrapIn } from "@milkdown/kit/prose/commands";
import { deleteQuoteBlockAtEdge } from "./block-delete";

/**
 * 折叠块（Tier A）：存储是普通引用 + 首行标记
 *
 *   > [!FOLD] 附属资料
 *   > 这里是被折叠的内容
 *
 * 本应用渲染成「标题行 + 折叠内容」；GitHub 等编辑器里仍是一段引用（能看到标记）。
 * 折叠状态只存在视图层，不写文件。
 */

const foldKey = new PluginKey<Set<number>>("md-fold-block");
const MARKER_RE = /\[!FOLD\]/i;
const MARKER_TEXT = "[!FOLD] ";

function buildDecorations(state: EditorState, folded: Set<number>): DecorationSet {
  const decos: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "blockquote") return true;
    const first = node.firstChild;
    if (!first || !first.isTextblock) return true;
    const text = first.textContent;
    const m = MARKER_RE.exec(text);
    if (!m) return true;

    const isFolded = folded.has(pos);
    decos.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: "md-foldblock",
        "data-folded": isFolded ? "true" : "false",
      }),
    );

    const textStart = pos + 2;
    const hideFrom = /^[/\s]*$/.test(text.slice(0, m.index)) ? textStart : textStart + m.index;
    decos.push(
      Decoration.inline(hideFrom, textStart + m.index + m[0].length, { class: "md-fold-mark" }),
    );

    // 标题行末尾放折叠箭头
    const headEnd = textStart + first.content.size;
    decos.push(
      Decoration.widget(headEnd, (view) => {
        const btn = document.createElement("span");
        btn.className = `md-fold-chevron${isFolded ? " folded" : ""}`;
        btn.setAttribute("contenteditable", "false");
        btn.setAttribute("title", isFolded ? "展开" : "收起");
        btn.addEventListener("mousedown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          view.dispatch(view.state.tr.setMeta(foldKey, { pos }));
        });
        return btn;
      }, { side: 1 }),
    );

    if (isFolded) {
      // 首个段落之外的块全部隐藏
      const contentStart = pos + 1;
      node.forEach((child, childOffset, index) => {
        if (index === 0) return;
        const childPos = contentStart + childOffset;
        decos.push(
          Decoration.node(childPos, childPos + child.nodeSize, { class: "md-fold-hidden" }),
        );
      });
    }
    return true;
  });
  return DecorationSet.create(state.doc, decos);
}

/** 把当前块包成折叠块；已在同类块里则只定位标题行 */
export function insertFoldBlock(view: { state: EditorState; dispatch: (tr: unknown) => void }): boolean {
  const { state } = view;
  const bq = state.schema.nodes.blockquote;
  if (!bq) return false;

  // 已在折叠块 / 引用里：补标记
  for (let depth = state.selection.$from.depth; depth > 0; depth -= 1) {
    const node = state.selection.$from.node(depth);
    if (node.type !== bq) continue;
    const text = node.firstChild?.textContent ?? "";
    if (MARKER_RE.test(text)) return true;
    const start = state.selection.$from.start(depth) + 1;
    const tr = state.tr.insertText(MARKER_TEXT, start);
    tr.setSelection(TextSelection.create(tr.doc, start + MARKER_TEXT.length));
    view.dispatch(tr.scrollIntoView());
    return true;
  }

  return wrapIn(bq)(state, (tr) => {
    const $pos = tr.selection.$from;
    let depth = $pos.depth;
    while (depth > 0 && $pos.node(depth).type !== bq) depth -= 1;
    if (depth > 0) {
      const start = $pos.start(depth) + 1;
      tr.insertText(MARKER_TEXT, start);
      tr.setSelection(TextSelection.create(tr.doc, start + MARKER_TEXT.length));
    }
    view.dispatch(tr.scrollIntoView());
  });
}

export function toggleFoldBlockAtCursor(view: { state: EditorState; dispatch: (tr: unknown) => void }): boolean {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name !== "blockquote") continue;
    const pos = $from.before(depth);
    view.dispatch(view.state.tr.setMeta(foldKey, { pos }));
    return true;
  }
  return false;
}

export const foldBlockPlugin = $prose(
  () =>
    new Plugin<Set<number>>({
      key: foldKey,
      state: {
        init: () => new Set<number>(),
        apply(tr, value) {
          const meta = tr.getMeta(foldKey) as { pos: number } | undefined;
          if (meta) {
            const next = new Set(value);
            if (next.has(meta.pos)) next.delete(meta.pos);
            else next.add(meta.pos);
            return next;
          }
          // 内容变化后位置可能失效：清空，避免折错块
          if (tr.docChanged) return new Set<number>();
          return value;
        },
      },
      props: {
        decorations: (state) => buildDecorations(state, foldKey.getState(state) ?? new Set()),
        // Mod-Alt+G：折叠 / 展开当前块；块首尾按删除键直接整块删掉
        handleKeyDown: (view, event) => {
          if (event.key === "Backspace" || event.key === "Delete") {
            const removed = deleteQuoteBlockAtEdge(view.state, (tr) => view.dispatch(tr as any), event.key);
            if (removed) {
              event.preventDefault();
              return true;
            }
            return false;
          }
          if (!event.altKey || !(event.ctrlKey || event.metaKey)) return false;
          if (event.key.toLowerCase() !== "g") return false;
          event.preventDefault();
          return toggleFoldBlockAtCursor(view as any);
        },
      },
    }),
);
