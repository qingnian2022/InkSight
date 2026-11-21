import type { Node as PmNode, Schema } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";

/** 找到光标/点击位置所在的表格节点及其在文档中的起点 */
export function tableAt(view: EditorView, pos: number): { node: PmNode; pos: number } | null {
  let $pos;
  try {
    $pos = view.state.doc.resolve(pos);
  } catch {
    return null;
  }
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (node.type.name === "table") {
      return { node, pos: $pos.before(depth) };
    }
  }
  return null;
}

export function readTable(node: PmNode): string[][] {
  const rows: string[][] = [];
  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      cells.push(cell.textContent);
    });
    rows.push(cells);
  });
  return rows;
}

function paragraphOf(schema: Schema, text: string) {
  return schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
}

/** 用二维数组重建 GFM 表格：首行是表头 */
export function buildTable(schema: Schema, rows: string[][]): PmNode | null {
  const { table, table_header_row, table_row, table_header, table_cell } = schema.nodes;
  if (!table || !table_header_row || !table_row || !table_header || !table_cell) return null;

  const cols = Math.max(1, ...rows.map((row) => row.length));
  const header = table_header_row.create(
    null,
    Array.from({ length: cols }, (_, c) =>
      table_header.create(null, paragraphOf(schema, rows[0]?.[c] ?? "")),
    ),
  );
  const body = rows.slice(1).map((row) =>
    table_row.create(
      null,
      Array.from({ length: cols }, (_, c) =>
        table_cell.create(null, paragraphOf(schema, row[c] ?? "")),
      ),
    ),
  );
  return table.create(null, [header, ...body]);
}
