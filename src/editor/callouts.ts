import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { wrapIn } from "@milkdown/kit/prose/commands";
import { deleteQuoteBlockAtEdge } from "./block-delete";
import { ANY_MARKER_RE, markerText } from "./markers";

/**
 * 语雀式提示块（Tier A：纯 Markdown 兼容）。
 *
 * 存储就是普通引用 + 首行标记：
 *   > [!TIP] 提示
 *   > 正文
 * GitHub / Obsidian / 语雀都能识别这套 Alerts 语法；本应用把它渲染成彩色卡片。
 * 标记文字用内联装饰隐藏，标题文字保留可编辑。
 */

export const CALLOUT_TYPES = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

// 标记允许出现在首段任意位置：斜杠菜单/输入法的时序问题可能把文字挤到标记前面，
// 这种情况仍然按提示块渲染，避免整块退化成普通引用。
const MARKER_RE = /\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/;

function buildDecorations(doc: EditorState["doc"]): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "blockquote") return true;
    const first = node.firstChild;
    if (!first || !first.isTextblock) return true;
    const text = first.textContent;
    const m = MARKER_RE.exec(text);
    if (!m) return true;

    const type = m[1].toLowerCase();
    const before = text.slice(0, m.index);
    const after = text.slice(m.index + m[0].length);
    // 去掉标记（以及它前面纯斜杠/空白）后没有内容 → 空块，CSS 补类型标签
    const rest = `${before}${after}`.replace(/^[/\s]+/, "").trim();

    decos.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: `md-callout md-callout-${type}`,
        "data-callout": type,
        ...(rest.length === 0 ? { "data-callout-empty": "true" } : {}),
      }),
    );

    // blockquote 内容起点 +1 = 段落内容起点，再 +1 是段落内文字起点
    const textStart = pos + 2;
    // 标记前面只有斜杠/空白时一并隐藏，避免露出 "/[!TIP]"
    const hideFrom = /^[/\s]*$/.test(before) ? textStart : textStart + m.index;
    decos.push(
      Decoration.inline(hideFrom, textStart + m.index + m[0].length, { class: "md-callout-mark" }),
    );
    return true;
  });
  return DecorationSet.create(doc, decos);
}

/** 把当前块包成提示块；已在引用里则只改类型标记。 */
function setCallout(type: CalloutType) {
  const marker = markerText(type);
  return (state: EditorState, dispatch?: (tr: any) => void): boolean => {
    const { schema } = state;
    const bq = schema.nodes.blockquote;
    const paragraph = schema.nodes.paragraph;
    if (!bq || !paragraph) return false;

    // 已经在引用里：替换 / 插入标记
    for (let depth = state.selection.$from.depth; depth > 0; depth -= 1) {
      const node = state.selection.$from.node(depth);
      if (node.type !== bq) continue;
      const start = state.selection.$from.start(depth) + 1;
      const text = node.firstChild?.textContent ?? "";
      const existing = ANY_MARKER_RE.exec(text);
      const tr = state.tr;
      if (existing) tr.insertText(marker, start, start + existing[0].length);
      else tr.insertText(marker, start);
      // 光标落到标记之后，接着写标题/正文
      const caret = start + marker.length;
      tr.setSelection(TextSelection.create(tr.doc, Math.min(caret, tr.doc.content.size)));
      dispatch?.(tr.scrollIntoView());
      return true;
    }

    // 普通段落：包一层引用，再写入标记
    return wrapIn(bq)(state, (tr) => {
      const $pos = tr.selection.$from;
      let depth = $pos.depth;
      while (depth > 0 && $pos.node(depth).type !== bq) depth -= 1;
      if (depth > 0) {
        const start = $pos.start(depth) + 1;
        tr.insertText(marker, start);
        const caret = start + marker.length;
        tr.setSelection(TextSelection.create(tr.doc, Math.min(caret, tr.doc.content.size)));
      }
      dispatch?.(tr.scrollIntoView());
    });
  };
}

/** 快捷键：Mod-Alt-1..5 依次对应 说明 / 提示 / 重要 / 注意 / 警告 */
const shortcutKeys: Record<string, CalloutType> = {
  "1": "note",
  "2": "tip",
  "3": "important",
  "4": "warning",
  "5": "caution",
};

/** keymap 插件不能直接塞进 props.handleKeyDown，这里手写匹配。 */
function handleShortcut(view: { state: EditorState; dispatch: (tr: unknown) => void }, event: KeyboardEvent): boolean {
  if (!event.altKey || !(event.ctrlKey || event.metaKey)) return false;
  const type = shortcutKeys[event.key];
  if (!type) return false;
  const ok = setCallout(type)(view.state, (tr) => view.dispatch(tr));
  if (ok) event.preventDefault();
  return ok;
}

export const calloutPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey("md-callout"),
      props: {
        decorations: (state) => buildDecorations(state.doc),
        handleKeyDown: (view, event) => {
          if (handleShortcut(view as any, event)) return true;
          if (event.key === "Backspace" || event.key === "Delete") {
            const done = deleteQuoteBlockAtEdge(view.state, (tr) => view.dispatch(tr as any), event.key);
            if (done) event.preventDefault();
            return done;
          }
          return false;
        },
      },
    }),
);

/** 给工具栏 / 斜杠菜单用：在当前光标处插入提示块。 */
export function insertCallout(view: { state: EditorState; dispatch: (tr: unknown) => void }, type: CalloutType) {
  return setCallout(type)(view.state, (tr) => view.dispatch(tr));
}
