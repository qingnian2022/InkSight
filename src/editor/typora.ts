import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import type { Line, Range, Text } from "@codemirror/state";

/**
 * Live Preview：
 * - 光标/选区所在的行保持原始 Markdown，方便精确编辑；
 * - 其余行渲染成结果（标题、列表、引用、表格、代码块、图片）；
 * - 装饰只作用于视图，文档内容一个字节都不改。
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

class FenceWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly source: string,
  ) {
    super();
  }

  eq(other: FenceWidget) {
    return other.lang === this.lang && other.source === this.source;
  }

  /** 让点击事件落到按钮上，而不是被编辑器吞掉 */
  ignoreEvent() {
    return false;
  }

  toDOM() {
    const bar = document.createElement("div");
    bar.className = "cm-code-bar";

    const lang = document.createElement("span");
    lang.className = "cm-code-lang";
    lang.textContent = this.lang || "plain";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "cm-code-copy";
    copy.textContent = "复制";
    copy.addEventListener("mousedown", (e) => e.preventDefault());
    copy.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void navigator.clipboard.writeText(this.source).then(
        () => {
          copy.textContent = "已复制";
          copy.dataset.state = "done";
          window.setTimeout(() => {
            copy.textContent = "复制";
            delete copy.dataset.state;
          }, 1200);
        },
        () => {
          copy.textContent = "失败";
        },
      );
    });

    bar.append(lang, copy);
    return bar;
  }
}

class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  eq(other: TableWidget) {
    return other.source === this.source;
  }

  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-table-widget";
    const rows = this.source
      .trim()
      .split("\n")
      .map((row) => splitRow(row));

    const table = document.createElement("table");
    const header = rows[0] ?? [];
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const cell of header) {
      const th = document.createElement("th");
      th.textContent = cell;
      headRow.appendChild(th);
    }
    head.appendChild(headRow);
    table.appendChild(head);

    const body = document.createElement("tbody");
    for (const row of rows.slice(2)) {
      const tr = document.createElement("tr");
      for (const cell of row) {
        const td = document.createElement("td");
        td.textContent = cell;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    table.appendChild(body);

    wrap.appendChild(table);
    return wrap;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }

  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-image-widget";
    if (/^(https?:|data:)/i.test(this.src)) {
      const img = document.createElement("img");
      img.src = this.src;
      img.alt = this.alt;
      wrap.appendChild(img);
    } else {
      wrap.textContent = `🖼 ${this.alt || this.src.split("/").pop() || "图片"}`;
      wrap.title = this.src;
    }
    return wrap;
  }
}

const bulletWidget = new BulletWidget();
const ruleWidget = new RuleWidget();

const RE_HEADING = /^(#{1,6})\s+/;
const RE_QUOTE = /^(?:>\s?)+/;
const RE_UL = /^(\s*)([-*+])\s+/;
const RE_OL = /^(\s*)(\d+[.)])\s+/;
const RE_RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const RE_FENCE = /^\s*(```|~~~)/;
const RE_TABLE_ROW = /^\s*\|.*\|\s*$/;

const RE_BOLD = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;
const RE_STRIKE = /~~(?=\S)(.+?)(?<=\S)~~/g;
const RE_CODE = /`([^`\n]+)`/g;
const RE_EM = /(?<!\*)\*(?!\*)(?=\S)(.+?)(?<=\S)\*(?!\*)/g;
const RE_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const RE_LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

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

  for (const match of text.matchAll(RE_IMAGE)) {
    const start = match.index ?? 0;
    out.push(
      Decoration.replace({ widget: new ImageWidget(match[2], match[1]) }).range(
        base + start,
        base + start + match[0].length,
      ),
    );
  }

  for (const match of text.matchAll(RE_LINK)) {
    const start = match.index ?? 0;
    if (text.slice(Math.max(0, start - 1), start) === "!") continue;
    const textFrom = base + start + 1;
    const textTo = textFrom + match[1].length;
    out.push(Decoration.mark({ class: "cm-link" }).range(textFrom, textTo));
    out.push(Decoration.replace({}).range(base + start, textFrom));
    out.push(Decoration.replace({}).range(textTo, base + start + match[0].length));
  }

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
    out.push(Decoration.line({ class: `cm-h${heading[1].length}` }).range(line.from));
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

  if (!isActive) {
    addInline(out, line);
  }
}

function rangeHasSelection(active: Set<number>, first: number, last: number): boolean {
  for (let n = first; n <= last; n += 1) {
    if (active.has(n)) return true;
  }
  return false;
}

function build(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const doc = view.state.doc;

  const active = new Set<number>();
  // 只读预览时不存在「活动行」，整篇按渲染结果显示
  if (view.state.facet(EditorView.editable)) {
    for (const range of view.state.selection.ranges) {
      const first = doc.lineAt(range.from).number;
      const last = doc.lineAt(range.to).number;
      for (let n = first; n <= last; n += 1) active.add(n);
    }
  }

  let i = 1;
  while (i <= doc.lines) {
    const line = doc.line(i);
    const text = line.text;

    if (RE_FENCE.test(text)) {
      let j = i + 1;
      while (j <= doc.lines && !RE_FENCE.test(doc.line(j).text)) j += 1;
      const end = Math.min(j, doc.lines);

      if (!rangeHasSelection(active, i, end)) {
        const lang = text.replace(/^\s*(```|~~~)/, "").trim();
        const lastCodeLine = RE_FENCE.test(doc.line(end).text) ? end - 1 : end;
        const codeSource =
          lastCodeLine >= i + 1 ? collectLines(doc, i + 1, lastCodeLine) : "";
        ranges.push(
          Decoration.replace({ widget: new FenceWidget(lang, codeSource) }).range(
            line.from,
            line.to,
          ),
        );
        for (let k = i + 1; k <= end; k += 1) {
          const inner = doc.line(k);
          const classes = ["cm-codeblock"];
          if (k === i + 1) classes.push("cm-codeblock-start");
          if (k === end) classes.push("cm-codeblock-end");
          ranges.push(Decoration.line({ class: classes.join(" ") }).range(inner.from));
        }
        if (end > i && RE_FENCE.test(doc.line(end).text)) {
          ranges.push(Decoration.replace({}).range(doc.line(end).from, doc.line(end).to));
        }
      }

      i = end + 1;
      continue;
    }

    if (RE_TABLE_ROW.test(text)) {
      let j = i;
      while (j <= doc.lines && RE_TABLE_ROW.test(doc.line(j).text)) j += 1;
      const end = j - 1;

      if (end > i) {
        if (!rangeHasSelection(active, i, end)) {
          const source = collectLines(doc, i, end);
          ranges.push(
            Decoration.replace({ widget: new TableWidget(source) }).range(
              doc.line(i).from,
              doc.line(end).to,
            ),
          );
        } else {
          for (let k = i; k <= end; k += 1) {
            ranges.push(Decoration.line({ class: "cm-table-source" }).range(doc.line(k).from));
          }
        }
        i = end + 1;
        continue;
      }
    }

    addLine(ranges, line, active.has(i));
    i += 1;
  }

  return Decoration.set(ranges, true);
}

function collectLines(doc: Text, first: number, last: number): string {
  const out: string[] = [];
  for (let n = first; n <= last; n += 1) out.push(doc.line(n).text);
  return out.join("\n");
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
