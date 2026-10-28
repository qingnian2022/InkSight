import { $remark } from "@milkdown/kit/utils";

/**
 * 解析阶段拍平嵌套引用：`> > 文字` 只保留一层引用。
 * 运行期由 noNestedQuote 插件兜底；这里负责「打开文档时」就干净。
 */
function flattenChildren(quote: any): any[] {
  const out: any[] = [];
  for (const child of quote.children ?? []) {
    if (child?.type === "blockquote") out.push(...flattenChildren(child));
    else out.push(child);
  }
  return out;
}

function walk(node: any) {
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) walk(child);
  node.children.forEach((child: any) => {
    if (child?.type !== "blockquote") return;
    child.children = flattenChildren(child);
  });
}

export const remarkFlattenQuote = $remark("remarkFlattenQuote", () => () => (tree: any) => {
  walk(tree);
});
