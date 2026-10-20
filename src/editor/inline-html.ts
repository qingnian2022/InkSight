import { $nodeSchema, $remark } from "@milkdown/kit/utils";

/**
 * 内联 HTML 彩色文字支持（<font style="color:..."> / <span style="color:...">）。
 *
 * 背景：有道云 / CSDN / 部分公众号导出的 Markdown 里大量出现内联 HTML 上色。
 * Milkdown 内置的 html 节点只是「把标签当纯文本显示」，颜色不渲染。
 *
 * 方案：
 * - remark 阶段把「开标签 + 中间内容 + 闭标签」合并成自定义 mdast 节点 coloredText
 *   （color 存在 node.data.color）；
 * - ProseMirror 侧 coloredText 是带 color 属性的内联节点，toDOM 渲染成
 *   <span style="color:...">，文字真正显示颜色；
 * - 序列化时输出回 <font style="color:...">xxx</font>，与导入格式保持一致，
 *   存盘仍是合法 Markdown（remark 内联 html）。
 *
 * 只处理 font / span 两个标签、只提取 color；<u>、<sub> 等其他标签维持原样。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const OPEN_TAG_RE = /^<(font|span)\b[^>]*>/i;
const CLOSE_TAG_RE = /^<\/(font|span)\s*>$/i;

/** 从开标签里提取颜色：优先 style="...color:..."，其次 color="..." 属性。 */
function extractColor(tag: string): string | null {
  const style = /style\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
  const fromStyle = /(?:^|;)\s*color\s*:\s*([^;"']+)/i.exec(style)?.[1]?.trim();
  if (fromStyle) return fromStyle;
  const fromAttr = /\scolor\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.trim();
  return fromAttr ?? null;
}

/**
 * 扫描一层内联 children：把 html 开标签到匹配闭标签之间的内容
 * 合并为 { type: "coloredText", data: { color }, children }。
 * 未闭合的标签原样放回（交给内置 html 节点当纯文本显示）。
 */
function mergeColoredRuns(children: any[]): any[] {
  const out: any[] = [];
  let open: { color: string; buffer: any[] } | null = null;

  for (const child of children) {
    if (child.type === "html") {
      const value = String(child.value ?? "").trim();
      if (!open) {
        const color = OPEN_TAG_RE.test(value) ? extractColor(value) : null;
        if (color) {
          open = { color, buffer: [] };
          continue;
        }
      } else if (CLOSE_TAG_RE.test(value)) {
        out.push({ type: "coloredText", data: { color: open.color }, children: open.buffer });
        open = null;
        continue;
      }
      if (open) open.buffer.push(child);
      else out.push(child);
      continue;
    }

    if (open) open.buffer.push(child);
    else out.push(child);
  }

  if (open) {
    // 标签没闭合（跨段/写到一半）：不吞内容，原样还原
    out.push({ type: "html", value: `<font style="color:${open.color}">` });
    out.push(...open.buffer);
  }
  return out;
}

/** 遍历 mdast 树，在每个有 children 的层级做合并（先合并再递归子级）。 */
function walkMdast(node: any) {
  if (!Array.isArray(node.children)) return;
  node.children = mergeColoredRuns(node.children);
  node.children.forEach(walkMdast);
}

/** remark 插件：解析 Markdown 时合并彩色内联 HTML。 */
export const mergeInlineColorHtml = $remark("mergeInlineColorHtml", () => () => (tree: any) => {
  walkMdast(tree);
});

/** coloredText 内联节点：渲染 <span style="color:...">，序列化回 <font>。 */
export const coloredTextSchema = $nodeSchema("coloredText", () => ({
  content: "inline*",
  group: "inline",
  inline: true,
  defining: true,
  attrs: {
    color: { default: "" },
  },
  parseDOM: [
    {
      tag: "span[data-colored-text]",
      getAttrs: (dom: HTMLElement) => ({ color: dom.dataset.coloredText || "" }),
    },
  ],
  toDOM: (node: any) => [
    "span",
    {
      "data-colored-text": "true",
      style: node.attrs.color ? `color:${node.attrs.color}` : undefined,
    },
    0,
  ],
  parseMarkdown: {
    match: (node: any) => node.type === "coloredText",
    runner: (state: any, node: any, type: any) => {
      state.openNode(type, { color: node.data?.color ?? "" });
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node: any) => node.type.name === "coloredText",
    runner: (state: any, node: any) => {
      const color = node.attrs.color || "inherit";
      state.addNode("html", void 0, `<font style="color:${color}">`);
      state.next(node.content);
      state.addNode("html", void 0, "</font>");
    },
  },
}));
