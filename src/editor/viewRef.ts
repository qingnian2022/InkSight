import { EditorView } from "@codemirror/view";

let current: EditorView | null = null;

export function setView(view: EditorView | null) {
  current = view;
}

export function getView(): EditorView | null {
  return current;
}

export function focusEditor() {
  current?.focus();
}

export function scrollToLine(lineNumber: number) {
  const view = current;
  if (!view) return;
  const total = view.state.doc.lines;
  const target = view.state.doc.line(Math.min(Math.max(1, lineNumber), total));
  view.dispatch({
    selection: { anchor: target.from },
    effects: EditorView.scrollIntoView(target.from, { y: "start", yMargin: 72 }),
  });
  view.focus();
}
