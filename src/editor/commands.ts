import { EditorSelection } from "@codemirror/state";
import { redo, undo } from "@codemirror/commands";
import { getView } from "./viewRef";

export function doUndo(): boolean {
  const view = getView();
  return view ? undo(view) : false;
}

export function doRedo(): boolean {
  const view = getView();
  return view ? redo(view) : false;
}

export function wrapSelection(before: string, after = before): boolean {
  const view = getView();
  if (!view) return false;

  const spec = view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to);
    const wrapped =
      text.length >= before.length + after.length &&
      text.startsWith(before) &&
      text.endsWith(after);

    if (wrapped) {
      const inner = text.slice(before.length, text.length - after.length);
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length),
      };
    }

    return {
      changes: { from: range.from, to: range.to, insert: before + text + after },
      range: EditorSelection.range(
        range.from + before.length,
        range.from + before.length + text.length,
      ),
    };
  });

  view.dispatch({ ...spec, scrollIntoView: true, userEvent: "input.format" });
  view.focus();
  return true;
}

export function cycleHeading(): boolean {
  const view = getView();
  if (!view) return false;

  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const match = /^(#{1,6})\s+/.exec(line.text);
  const level = match ? match[1].length : 0;
  const next = level >= 6 ? 0 : level + 1;
  const to = match ? line.from + match[0].length : line.from;
  const insert = next === 0 ? "" : `${"#".repeat(next)} `;

  view.dispatch({
    changes: { from: line.from, to, insert },
    selection: { anchor: line.from + insert.length },
    scrollIntoView: true,
    userEvent: "input.format",
  });
  view.focus();
  return true;
}

export function toggleLinePrefix(prefix: string): boolean {
  const view = getView();
  if (!view) return false;

  const { from, to } = view.state.selection.main;
  const first = view.state.doc.lineAt(from).number;
  const last = view.state.doc.lineAt(to).number;
  const changes: { from: number; to: number; insert: string }[] = [];

  for (let n = first; n <= last; n += 1) {
    const line = view.state.doc.line(n);
    if (line.text.startsWith(prefix)) {
      changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
    } else {
      changes.push({ from: line.from, to: line.from, insert: prefix });
    }
  }

  view.dispatch({ changes, scrollIntoView: true, userEvent: "input.format" });
  view.focus();
  return true;
}

export function insertBlock(text: string, cursorOffset: number): boolean {
  const view = getView();
  if (!view) return false;

  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + cursorOffset },
    scrollIntoView: true,
    userEvent: "input.format",
  });
  view.focus();
  return true;
}

export function insertLink(): boolean {
  const view = getView();
  if (!view) return false;

  const { from, to } = view.state.selection.main;
  const label = view.state.sliceDoc(from, to) || "链接文字";
  const insert = `[${label}](https://)`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length - 1 },
    scrollIntoView: true,
    userEvent: "input.format",
  });
  view.focus();
  return true;
}

export function insertImage(): boolean {
  const view = getView();
  if (!view) return false;

  const { from } = view.state.selection.main;
  const insert = "![](./assets/)";
  view.dispatch({
    changes: { from, insert },
    selection: { anchor: from + insert.length - 1 },
    scrollIntoView: true,
    userEvent: "input.format",
  });
  view.focus();
  return true;
}

export const formatBold = () => wrapSelection("**");
export const formatItalic = () => wrapSelection("*");
export const formatStrike = () => wrapSelection("~~");
export const formatCode = () => wrapSelection("`");
export const formatQuote = () => toggleLinePrefix("> ");
export const formatUl = () => toggleLinePrefix("- ");
export const formatOl = () => toggleLinePrefix("1. ");
export const formatTask = () => toggleLinePrefix("- [ ] ");
export const insertCodeBlock = () => insertBlock("```\n\n```", 4);
export const insertRule = () => insertBlock("\n---\n", 5);
