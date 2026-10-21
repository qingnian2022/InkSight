import { $remark } from "@milkdown/kit/utils";

/**
 * 强调（加粗/斜体）归一化：把同步/导入后常见的「星号失效」写法救回来。
 *
 * 处理三类：
 * 1. 全角星号 ＊＊加粗＊＊ → **加粗**（微信/有道导出常见）
 * 2. 星号内侧带空格：** 加粗 ** → **加粗**（CommonMark 严格不认）
 * 3. 反引号整体包住的强调：`**加粗**` → 真正的加粗（导出工具常这样包）
 * 4. <b>/<strong> 标签对：内容里的 ** 一并还原成 strong
 *
 * 只改 text / inlineCode / html 节点，不动代码块与链接地址。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const BOLD_CODE_RE = /^\s*\*\*\s*([^*]+?)\s*\*\*\s*$/;
const ITALIC_CODE_RE = /^\s*\*\s*([^*]+?)\s*\*\s*$/;
const OPEN_B_RE = /^<(b|strong)\b[^>]*>$/i;
const CLOSE_B_RE = /^<\/(b|strong)\s*>$/i;

function normalizeText(value: string): string {
  return value
    .replace(/＊/g, "*") // 全角星号
    .replace(/\*\*\s+([^*\n]+?)\s+\*\*/g, "**$1**") // ** 加粗 ** → **加粗**
    .replace(/(^|[^\*])\*\s+([^*\n]+?)\s+\*(?!\*)/g, "$1*$2*"); // * 斜体 * → *斜体*
}

function fixRuns(children: any[]): any[] {
  const out: any[] = [];
  let open: any[] | null = null;

  for (const child of children) {
    // ── <b>/<strong> 标签对 ──
    if (child.type === "html") {
      const value = String(child.value ?? "").trim();
      if (!open && OPEN_B_RE.test(value)) {
        open = [];
        continue;
      }
      if (open && CLOSE_B_RE.test(value)) {
        out.push({ type: "strong", children: open });
        open = null;
        continue;
      }
    }

    let node = child;

    // ── 反引号整体包住的强调 ──
    if (child.type === "inlineCode" && typeof child.value === "string") {
      const bold = BOLD_CODE_RE.exec(child.value);
      if (bold) {
        node = { type: "strong", children: [{ type: "text", value: bold[1] }] };
      } else {
        const italic = ITALIC_CODE_RE.exec(child.value);
        if (italic) {
          node = { type: "emphasis", children: [{ type: "text", value: italic[1] }] };
        }
      }
    }

    // ── 文本节点归一化 ──
    if (node.type === "text" && typeof node.value === "string") {
      const v = normalizeText(node.value);
      if (v !== node.value) node = { ...node, value: v };
    }

    if (open) open.push(node);
    else out.push(node);
  }

  // 未闭合的 <b>：不吞内容，原样放回
  if (open) {
    out.push({ type: "html", value: "<b>" }, ...open);
  }
  return out;
}

function walk(node: any) {
  if (!Array.isArray(node.children)) return;
  node.children = fixRuns(node.children);
  node.children.forEach(walk);
}

export const normalizeEmphasis = $remark("normalizeEmphasis", () => () => (tree: any) => {
  walk(tree);
});
