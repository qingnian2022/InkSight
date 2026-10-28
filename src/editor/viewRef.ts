import { EditorSelection, EditorState } from "@codemirror/state";
import { redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { getPmView } from "./pmViewRef";
import { state } from "../store";

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

/** 去掉 Markdown 标记，用于「大纲里的文字」和「渲染后的标题文字」比对 */
function plain(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .trim();
}

/** 富文本模式：按标题文字定位并滚动（大纲点击用） */
function scrollPmToHeading(text: string, occurrence: number): boolean {
  const view = getPmView();
  if (!view) return false;
  const want = plain(text);

  const exact: number[] = [];
  const loose: number[] = [];
  view.state.doc.descendants((node, pos, parent) => {
    if (node.type.name !== "heading") return true;
    // 只认顶层标题：引用/折叠块里的小标题不该被大纲命中
    if (parent && parent.type.name !== "doc") return true;
    const got = plain(node.textContent);
    if (got === want) exact.push(pos);
    else if (want && got.startsWith(want)) loose.push(pos);
    return true;
  });

  const list = exact.length ? exact : loose;
  const target = list[Math.min(occurrence, list.length - 1)];
  if (target === undefined) return false;

  const dom = view.nodeDOM(target) as HTMLElement | null;
  if (!dom) return false;

  // 只滚动，不动选区：改选区会触发 ProseMirror 自己把光标滚进视野，
  // 和这里的定位互相抢，表现为"落点偏移 / 方向忽上忽下"。
  dom.scrollIntoView({ block: "start", inline: "nearest", behavior: "smooth" });
  return true;
}

export function scrollToHeading(text: string, occurrence = 0) {
  // 富文本模式：CodeMirror 视图不存在，必须走 ProseMirror
  if (scrollPmToHeading(text, occurrence)) return;

  const view = current;
  if (!view) return;
  const target = text.trim();
  for (let i = 1; i <= view.state.doc.lines; i += 1) {
    const line = view.state.doc.line(i);
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line.text);
    if (match && match[1].trim() === target) {
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 72 }),
      });
      view.focus();
      return;
    }
  }
}

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

function replaceLinePrefix(next: string): boolean {
  const view = getView();
  if (!view) return false;
  const target = view.state.doc.lineAt(view.state.selection.main.head);
  const match = /^(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)?/.exec(target.text);
  const prefixLen = match ? match[0].length : 0;

  view.dispatch({
    changes: { from: target.from, to: target.from + prefixLen, insert: next },
    selection: { anchor: target.from + next.length },
    scrollIntoView: true,
    userEvent: "input.format",
  });
  view.focus();
  return true;
}

export function setHeading(level: number): boolean {
  return replaceLinePrefix(`${"#".repeat(level)} `);
}

export function setParagraph(): boolean {
  return replaceLinePrefix("");
}

export function cycleHeading(): boolean {
  const view = getView();
  if (!view) return false;
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const match = /^(#{1,6})\s+/.exec(line.text);
  const level = match ? match[1].length : 0;
  const next = level >= 6 ? 0 : level + 1;
  return next === 0 ? setParagraph() : setHeading(next);
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

const formatBold = () => wrapSelection("**");
const formatItalic = () => wrapSelection("*");
const formatStrike = () => wrapSelection("~~");
const formatCode = () => wrapSelection("`");
const formatQuote = () => toggleLinePrefix("> ");
const formatUl = () => toggleLinePrefix("- ");
const formatOl = () => toggleLinePrefix("1. ");
const formatTask = () => toggleLinePrefix("- [ ] ");
const insertCodeBlock = () => insertBlock("```\n\n```", 4);
const insertRule = () => insertBlock("\n---\n", 5);

export const formatCommands = {
  bold: formatBold,
  italic: formatItalic,
  strike: formatStrike,
  code: formatCode,
  quote: formatQuote,
  ul: formatUl,
  ol: formatOl,
  task: formatTask,
  codeBlock: insertCodeBlock,
  rule: insertRule,
  link: insertLink,
};

/** 光标所在行的块类型与行内标记，供工具栏显示激活态。 */
export function detectBlockType(editorState: EditorState): string {
  const line = editorState.doc.lineAt(editorState.selection.main.head);
  const text = line.text;
  if (/^#{1,6}\s/.test(text)) {
    const level = (/^#+/.exec(text) ?? [""])[0].length;
    return `h${level}`;
  }
  if (/^>\s?/.test(text)) return "quote";
  if (/^\s*```/.test(text)) return "code";
  if (/^\s*[-*+]\s+\[[ xX]\]\s+/.test(text)) return "task";
  if (/^\s*[-*+]\s+/.test(text)) return "bullet";
  if (/^\s*\d+[.)]\s+/.test(text)) return "ordered";
  return "paragraph";
}

export function detectMarks(editorState: EditorState): string[] {
  const line = editorState.doc.lineAt(editorState.selection.main.head);
  const offset = editorState.selection.main.head - line.from;
  const text = line.text;
  const marks: string[] = [];

  const patterns: Array<[string, RegExp]> = [
    ["strong", /\*\*([^*]+)\*\*/g],
    ["emphasis", /(?<!\*)\*([^*]+)\*(?!\*)/g],
    ["strike", /~~([^~]+)~~/g],
    ["inlineCode", /`([^`]+)`/g],
  ];

  for (const [name, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      if (offset >= start && offset <= start + match[0].length) {
        marks.push(name);
        break;
      }
    }
  }
  return marks;
}

export function syncEditorFlags(editorState: EditorState) {
  state.blockType = detectBlockType(editorState);
  state.activeMarks = detectMarks(editorState);
}
