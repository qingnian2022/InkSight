import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import type { Line, Range } from "@codemirror/state";

/**
 * Typora 式即时渲染：
 * - 光标所在行（含选区的行）保持原始 Markdown，便于精确编辑；
 * - 其余行隐藏 `#`、`>`、`**` 等标记，只呈现结果；
 * - 所有装饰都是视图层的，绝不改写文档内容。
 */

class BulletWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-bullet";
    span.textContent = "•";
    return span;
  }
}

class RuleWidget extends WidgetType {
  toDOM() {
    const div = document.createElement("div");
    div.className = "cm-hr";
    return div;
  }
}

const bulletWidget = new BulletWidget();
const ruleWidget = new RuleWidget();

const RE_HEADING = /^(#{1,6})\s+/;
const RE_QUOTE = /^(?:>\s?)+/;
const RE_UL = /^(\s*)([-*+])\s+/;
const RE_OL = /^(\s*)(\d+[.)])\s+/;
const RE_RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const RE_FENCE = /^\s*(?:```|~~~)/;

const RE_BOLD = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;
const RE_STRIKE = /~~(?=\S)(.+?)(?<=\S)~~/g;
const RE_CODE = /`([^`\n]+)`/g;
const RE_EM = /(?<!\*)\*(?!\*)(?=\S)(.+?)(?<=\S)\*(?!\*)/g;

function hideInline(
  out: Range<Decoration>[],
  base: number,
  start: number,
  end: number,
  cls: string,
  openLen: number,
  closeLen: number,
) {
  const innerFrom = base + start + openLen;
  const innerTo = base + end - closeLen;
  if (innerTo <= innerFrom) return;
  out.push(Decoration.mark({ class: cls }).range(innerFrom, innerTo));
  out.push(Decoration.replace({}).range(base + start, innerFrom));
  out.push(Decoration.replace({}).range(innerTo, base + end));
}

function addInline(out: Range<Decoration>[], line: Line) {
  const text = line.text;
  const base = line.from;

  for (const match of text.matchAll(RE_BOLD)) {
    const start = match.index ?? 0;
    hideInline(out, base, start, start + match[0].length, "cm-strong", 2, 2);
  }
  for (const match of text.matchAll(RE_STRIKE)) {
    const start = match.index ?? 0;
    hideInline(out, base, start, start + match[0].length, "cm-strike", 2, 2);
  }
  for (const match of text.matchAll(RE_CODE)) {
    const start = match.index ?? 0;
    hideInline(out, base, start, start + match[0].length, "cm-inline-code", 1, 1);
  }
  for (const match of text.matchAll(RE_EM)) {
    const start = match.index ?? 0;
    hideInline(out, base, start, start + match[0].length, "cm-em", 1, 1);
  }
}

function addLine(out: Range<Decoration>[], line: Line, isActive: boolean) {
  const text = line.text;
  if (text.length === 0) return;

  if (RE_RULE.test(text)) {
    if (!isActive) {
      out.push(Decoration.replace({ widget: ruleWidget }).range(line.from, line.to));
    }
    return;
  }

  const heading = RE_HEADING.exec(text);
  if (heading) {
    const level = heading[1].length;
    out.push(Decoration.line({ class: `cm-h${level}` }).range(line.from));
    if (!isActive) {
      out.push(Decoration.replace({}).range(line.from, line.from + heading[0].length));
    }
  }

  const quote = RE_QUOTE.exec(text);
  if (quote) {
    out.push(Decoration.line({ class: "cm-quote" }).range(line.from));
    if (!isActive) {
      out.push(Decoration.replace({}).range(line.from, line.from + quote[0].length));
    }
  }

  if (!heading) {
    const ul = RE_UL.exec(text);
    if (ul) {
      out.push(Decoration.line({ class: "cm-ul" }).range(line.from));
      const markerFrom = line.from + ul[1].length;
      const markerTo = markerFrom + ul[2].length + 1;
      if (!isActive) {
        out.push(Decoration.replace({ widget: bulletWidget }).range(markerFrom, markerTo));
      }
    }
  }

  const ol = RE_OL.exec(text);
  if (ol) {
    out.push(Decoration.line({ class: "cm-ol" }).range(line.from));
    const from = line.from + ol[1].length;
    const to = from + ol[2].length;
    out.push(Decoration.mark({ class: "cm-listmark" }).range(from, to));
  }

  if (RE_FENCE.test(text)) {
    out.push(Decoration.line({ class: "cm-fence" }).range(line.from));
    return;
  }

  if (!isActive) {
    addInline(out, line);
  }
}

function build(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const doc = view.state.doc;

  const active = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;
    for (let n = first; n <= last; n += 1) active.add(n);
  }

  const seen = new Set<number>();
  for (const visible of view.visibleRanges) {
    let pos = Math.max(0, visible.from);
    const limit = Math.min(visible.to, doc.length);
    while (pos <= limit) {
      const line = doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        addLine(ranges, line, active.has(line.number));
      }
      if (line.to >= doc.length) break;
      pos = line.to + 1;
    }
  }

  return Decoration.set(ranges, true);
}

export const typoraRendering = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = build(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged
      ) {
        this.decorations = build(update.view);
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
);
