import { $nodeSchema } from "@milkdown/kit/utils";

/**
 * 覆盖 GFM 的 table 节点：把 content 从 `table_header_row table_row+` 放宽为
 * `table_header_row table_row*`，允许「只有表头」的表格存在。
 *
 * 为什么需要：用户删行时应该能一路删到只剩表头；原 schema 强制至少一行数据行，
 * 删到 1 行再删就整表崩掉（prosemirror-tables 会修复/删除表格）。
 * GFM 本身允许 `| a | b |\n| --- | --- |` 这种无数据行的表格，所以序列化/解析都成立。
 *
 * 注册顺序：milkdown 的 nodesCtx 按数组顺序合并成 schema，同名后者覆盖前者，
 * 所以必须在 Crepe（含 preset-gfm）之后 use 这个插件。
 */
export const tableSchemaOverride = $nodeSchema("table", () => ({
  content: "table_header_row table_row*",
  tableRole: "table",
  isolating: true,
  group: "block",
  disableDropCursor: true,
  parseDOM: [{ tag: "table" }],
  toDOM: () => ["table", ["tbody", 0]],
  parseMarkdown: {
    match: (node: any) => node.type === "table",
    runner: (state: any, node: any, type: any) => {
      const align = node.align;
      const children = node.children.map((x: any, i: number) => ({
        ...x,
        align,
        isHeader: i === 0,
      }));
      state.openNode(type);
      state.next(children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node: any) => node.type.name === "table",
    runner: (state: any, node: any) => {
      const firstLine = node.content.firstChild?.content;
      if (!firstLine) return;
      const align: any[] = [];
      firstLine.forEach((cell: any) => {
        align.push(cell.attrs.alignment);
      });
      state.openNode("table", undefined, { align });
      state.next(node.content);
      state.closeNode();
    },
  },
}));
