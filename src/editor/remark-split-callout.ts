import { $remark } from "@milkdown/kit/utils";

/**
 * 提示块 / 折叠块的「首行标题」拆分。
 *
 * Markdown 里这样写：
 *   > [!FOLD] 附属资料
 *   > 正文第一行
 * 两行属于**同一个段落**（软换行），渲染时标题和正文会挤在一起，
 * 折叠块也就没有可折叠的正文。这里在 mdast 阶段按第一个换行把首段拆成两段：
 *   > [!FOLD] 附属资料
 *   >
 *   > 正文第一行
 * 序列化回去会多一个 `>` 空行，语义相同，阅读更清楚。
 */

const MARKER = /^[\/\s]*\[!(FOLD|NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;

/* eslint-disable @typescript-eslint/no-explicit-any */
type MdNode = any;

function splitAtNewline(children: MdNode[]): { head: MdNode[]; tail: MdNode[] } | null {
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    // 软换行在 mdast 里可能是 break 节点，也可能是 text 里的 "\n"
    if (child.type === "break") {
      return { head: children.slice(0, i), tail: children.slice(i + 1) };
    }
    if (typeof child.value !== "string" || !child.value.includes("\n")) continue;
    const lines = child.value.split("\n");
    const before = lines.shift() ?? "";
    const after = lines.join("\n");

    const head = children.slice(0, i);
    if (before) head.push({ ...child, value: before });
    const tail: MdNode[] = [];
    if (after) tail.push({ ...child, value: after });
    tail.push(...children.slice(i + 1));
    return { head, tail };
  }
  return null;
}

function textOf(node: MdNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(textOf).join("");
}

function walk(node: MdNode) {
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) {
    if (child.type === "blockquote" && child.children?.length) {
      const first = child.children[0];
      if (first.type === "paragraph" && MARKER.test(textOf(first))) {
        const split = splitAtNewline(first.children ?? []);
        if (split) {
          child.children.splice(
            0,
            1,
            { ...first, children: split.head },
            { ...first, children: split.tail },
          );
        }
      }
    }
    walk(child);
  }
}

export const remarkSplitCallout = $remark("remarkSplitCallout", () => () => (tree: any) => {
  walk(tree);
});
