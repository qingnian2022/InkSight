import { $prose } from "@milkdown/kit/utils";
import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorState } from "@milkdown/kit/prose/state";

const MARKER_RE = /\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|FOLD)\]/gi;

/** 去掉隐藏标记后还剩多少可见文字 */
function visibleText(node: { textContent: string }): string {
  return node.textContent.replace(MARKER_RE, "").replace(/^[/\s]+/, "").trim();
}


/**
 * 引用类块（提示块 / 折叠块）的整块删除。
 *
 * 标记 `[!TIP]` 是隐藏的元数据，用户把可见文字删光后标记还留在文档里，
 * 看起来像"删不干净"。这里让 Backspace / Delete 在块首尾时直接删掉整个引用块。
 */
export function deleteQuoteBlockAtEdge(
  state: EditorState,
  dispatch?: (tr: unknown) => void,
  key?: string,
): boolean {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;

  let depth = -1;
  for (let d = $from.depth; d > 0; d -= 1) {
    if ($from.node(d).type.name === "blockquote") {
      depth = d;
      break;
    }
  }
  if (depth < 0) return false;

  const bq = $from.node(depth);
  const bqPos = $from.before(depth);
  const isBackspace = key === "Backspace";

  // 块里只剩隐藏标记（没有可见文字）：不管光标在哪，删除键一律清空整块
  const text = visibleText(bq);
  if (text.length === 0) {
    const tr = state.tr.delete(bqPos, bqPos + bq.nodeSize);
    dispatch?.(tr.scrollIntoView());
    return true;
  }

  if (isBackspace) {
    // 光标在该引用块第一个文字块的最前面
    const atStart = $from.pos === bqPos + 2;
    if (!atStart) return false;
  } else {
    // 光标在该引用块最后一个文字块的最后面
    const endPos = bqPos + bq.nodeSize - 2;
    if ($from.pos !== endPos) return false;
  }

  const tr = state.tr.delete(bqPos, bqPos + bq.nodeSize);
  dispatch?.(tr.scrollIntoView());
  return true;
}

/**
 * 兜底清理：用户把提示块 / 折叠块里的可见文字删光后，只剩一个隐藏标记，
 * 看起来像"没删干净"。这里在删除型事务后，把**光标所在**的这类空块整块移除。
 *
 * 只处理光标所在的块，避免误删别处本来就空着的提示块；
 * 也只对「文字变少」的事务生效，所以刚插入的空块不会被删掉。
 */
export const emptyQuoteCleanup = $prose(
  () =>
    new Plugin({
      appendTransaction(trs, oldState, newState) {
        const changed = trs.some((tr) => tr.docChanged);
        if (!changed) return null;
        if (newState.doc.textContent.length >= oldState.doc.textContent.length) return null;

        const { $from } = newState.selection;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const node = $from.node(depth);
          if (node.type.name !== "blockquote") continue;
          if (visibleText(node).length > 0) return null;
          const pos = $from.before(depth);
          return newState.tr.delete(pos, pos + node.nodeSize).scrollIntoView();
        }
        return null;
      },
    }),
);
