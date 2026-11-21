import { invoke } from "@tauri-apps/api/core";
import { reactive } from "vue";
import { notify } from "./store";

/** 表格：CSV 是真存储（Excel 能直接开），编辑时在内存里做二维数组 */

export type SheetRows = string[][];

/** 解析 CSV：支持引号包裹、字段内逗号/换行、"" 转义 */
export function parseCsv(text: string): SheetRows {
  const rows: SheetRows = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.length ? rows : [[""]];
}

export function serializeCsv(rows: SheetRows): string {
  const escape = (value: string) => {
    const v = value ?? "";
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return rows.map((row) => row.map(escape).join(",")).join("\r\n") + "\r\n";
}

/** 从 Excel / 网页复制出来的是 TSV */
export function parseTsv(text: string): SheetRows {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => line.split("\t"));
}

export function normalize(rows: SheetRows): SheetRows {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const width = Math.min(cols, 64);
  return rows.map((row) => {
    const next = row.slice(0, width);
    while (next.length < width) next.push("");
    return next;
  });
}

export const DEFAULT_COL_WIDTH = 132;

export const sheetStore = reactive({
  open: false,
  path: "",
  name: "",
  rows: [[""]] as SheetRows,
  /** 每列宽度（px），按文件路径存在 localStorage */
  widths: [DEFAULT_COL_WIDTH] as number[],
  cursorRow: 0,
  cursorCol: 0,
  /** 选区锚点：Shift+点击 从锚点拉到当前格 */
  anchorRow: 0,
  anchorCol: 0,
  loading: false,
  mode: "file" as SheetMode,
  saving: false,
});

export function openSheetInDialog(path: string, name: string, text: string) {
  sheetStore.path = path;
  sheetStore.name = name;
  sheetStore.rows = normalize(parseCsv(text));
  sheetStore.widths = loadWidths(path, sheetStore.rows[0]?.length ?? 1);
  sheetStore.cursorRow = 0;
  sheetStore.cursorCol = 0;
  sheetStore.anchorRow = 0;
  sheetStore.anchorCol = 0;
  sheetStore.mode = "file";
  sheetStore.open = true;
}

export async function openLocalSheet(path: string, name: string) {
  sheetStore.loading = true;
  try {
    const text = await invoke<string>("local_read_text", { path });
    openSheetInDialog(path, name, text);
  } catch (err) {
    notify(String(err));
  } finally {
    sheetStore.loading = false;
  }
}

export async function saveSheet() {
  if (sheetStore.mode === "inline") {
    inlineApply?.(normalize(sheetStore.rows));
    inlineApply = null;
    sheetStore.mode = "file";
    sheetStore.open = false;
    notify("表格已更新");
    return;
  }
  if (!sheetStore.path) return;
  sheetStore.saving = true;
  try {
    await invoke("local_write_text", {
      path: sheetStore.path,
      content: serializeCsv(normalize(sheetStore.rows)),
    });
    sheetStore.open = false;
    notify("已保存：" + sheetStore.name);
  } catch (err) {
    notify(String(err));
  } finally {
    sheetStore.saving = false;
  }
}

export function isNumeric(value: string) {
  return value.trim() !== "" && !Number.isNaN(Number(value));
}

/* ---------- 列宽 / 光标位置 / 行列操作 ---------- */

const widthKey = (path: string) => "md-rust.sheet-w:" + path;

export function loadWidths(path: string, cols: number): number[] {
  let stored: number[] = [];
  try {
    const raw = localStorage.getItem(widthKey(path));
    if (raw) stored = JSON.parse(raw) as number[];
  } catch {
    stored = [];
  }
  const next: number[] = [];
  for (let i = 0; i < cols; i += 1) {
    const w = stored[i];
    next.push(typeof w === "number" && w >= 56 && w <= 520 ? w : DEFAULT_COL_WIDTH);
  }
  return next;
}

export function saveWidths() {
  if (!sheetStore.path) return;
  try {
    localStorage.setItem(widthKey(sheetStore.path), JSON.stringify(sheetStore.widths));
  } catch {
    // 存不下不影响本次使用
  }
}

export function setCursor(row: number, col: number) {
  sheetStore.cursorRow = Math.max(0, row);
  sheetStore.cursorCol = Math.max(0, col);
}

export function insertRowAt(index: number) {
  const rows = sheetStore.rows.map((row) => [...row]);
  const width = rows[0]?.length ?? 1;
  rows.splice(Math.min(index, rows.length), 0, new Array(width).fill(""));
  sheetStore.rows = normalize(rows);
}

export function insertColAt(index: number) {
  const rows = sheetStore.rows.map((row) => {
    const next = [...row];
    next.splice(Math.min(index, next.length), 0, "");
    return next;
  });
  sheetStore.rows = normalize(rows);
  sheetStore.widths.splice(Math.min(index, sheetStore.widths.length), 0, DEFAULT_COL_WIDTH);
  saveWidths();
}

export function deleteRowAt(index: number) {
  if (sheetStore.rows.length <= 1) return;
  const rows = sheetStore.rows.filter((_, i) => i !== index);
  sheetStore.rows = normalize(rows);
  setCursor(Math.min(index, rows.length - 1), sheetStore.cursorCol);
}

export function deleteColAt(index: number) {
  if ((sheetStore.rows[0]?.length ?? 0) <= 1) return;
  sheetStore.rows = normalize(sheetStore.rows.map((row) => row.filter((_, i) => i !== index)));
  sheetStore.widths.splice(index, 1);
  saveWidths();
  setCursor(sheetStore.cursorRow, Math.min(index, sheetStore.rows[0].length - 1));
}

/** 复制成 TSV，粘回 Excel 时能直接分列 */
export function rowsToTsv(rows: SheetRows): string {
  return rows.map((row) => row.join("\t")).join("\n");
}

/* ---------- 选区 ---------- */

export interface SheetRange {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** 把锚点与当前格规范成左上/右下 */
export function selectionRange(): SheetRange {
  return {
    r0: Math.min(sheetStore.anchorRow, sheetStore.cursorRow),
    c0: Math.min(sheetStore.anchorCol, sheetStore.cursorCol),
    r1: Math.max(sheetStore.anchorRow, sheetStore.cursorRow),
    c1: Math.max(sheetStore.anchorCol, sheetStore.cursorCol),
  };
}

export function isSelected(row: number, col: number) {
  const r = selectionRange();
  return row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1;
}

export function setAnchor(row: number, col: number) {
  sheetStore.anchorRow = row;
  sheetStore.anchorCol = col;
}

export function selectionTsv(): string {
  const r = selectionRange();
  const lines: string[] = [];
  for (let row = r.r0; row <= r.r1; row += 1) {
    lines.push(sheetStore.rows[row].slice(r.c0, r.c1 + 1).join("\t"));
  }
  return lines.join("\n");
}

export function clearSelection() {
  const r = selectionRange();
  const rows = sheetStore.rows.map((row) => [...row]);
  for (let row = r.r0; row <= r.r1; row += 1) {
    for (let col = r.c0; col <= r.c1; col += 1) {
      if (rows[row]) rows[row][col] = "";
    }
  }
  sheetStore.rows = rows;
}

/* ---------- 排序 ---------- */

/** 按某列排序；首行默认当表头不参与 */
export function sortByColumn(col: number, ascending: boolean) {
  const rows = sheetStore.rows;
  if (rows.length < 3) return;
  const head = rows[0].map((v) => v);
  const body = rows.slice(1).map((row) => [...row]);
  body.sort((a, b) => {
    const av = a[col] ?? "";
    const bv = b[col] ?? "";
    const an = Number(av);
    const bn = Number(bv);
    const bothNumeric = av.trim() !== "" && bv.trim() !== "" && !Number.isNaN(an) && !Number.isNaN(bn);
    const cmp = bothNumeric ? an - bn : av.localeCompare(bv, "zh-Hans-CN");
    return ascending ? cmp : -cmp;
  });
  sheetStore.rows = [head, ...body];
}

/* ---------- 公式（只支持基础函数与四则运算，够日常统计） ---------- */

export function columnName(col: number) {
  let name = "";
  let n = col + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    name = String.fromCharCode(65 + m) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function parseRef(ref: string): { row: number; col: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

function formatNumber(n: number) {
  if (!Number.isFinite(n)) return "#ERR";
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

/** 计算整表：公式格返回结果，普通格返回原文 */
export function computeGrid(rows: SheetRows): string[][] {
  const cache = new Map<string, number | string>();
  const busy = new Set<string>();
  const keyOf = (row: number, col: number) => `${row},${col}`;

  const rawAt = (row: number, col: number) => rows[row]?.[col] ?? "";

  const numberAt = (row: number, col: number): number => {
    const v = valueAt(row, col);
    if (typeof v === "number") return v;
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  };

  const valueAt = (row: number, col: number): number | string => {
    const key = keyOf(row, col);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    if (busy.has(key)) return "#CYCLE";
    const raw = rawAt(row, col);
    if (!raw.startsWith("=")) {
      const n = raw.trim() === "" ? 0 : Number(raw);
      return Number.isNaN(n) ? raw : n;
    }
    busy.add(key);
    let result: number | string;
    try {
      result = evalFormula(raw.slice(1));
    } catch {
      result = "#ERR";
    }
    busy.delete(key);
    cache.set(key, result);
    return result;
  };

  const rangeValues = (from: string, to: string): number[] => {
    const a = parseRef(from);
    const b = parseRef(to);
    if (!a || !b) return [];
    const out: number[] = [];
    for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r += 1) {
      for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c += 1) {
        const v = valueAt(r, c);
        if (typeof v === "number") out.push(v);
        else if (v !== "" && !String(v).startsWith("#")) {
          const n = Number(v);
          if (!Number.isNaN(n)) out.push(n);
        }
      }
    }
    return out;
  };

  /** 递归下降：只有 + - * / 、括号、单元格引用和几个聚合函数 */
  function evalFormula(src: string): number | string {
    let i = 0;
    const skip = () => {
      while (i < src.length && /\s/.test(src[i])) i += 1;
    };

    function parseExpr(): number {
      let value = parseTerm();
      for (;;) {
        skip();
        const ch = src[i];
        if (ch !== "+" && ch !== "-") break;
        i += 1;
        const rhs = parseTerm();
        value = ch === "+" ? value + rhs : value - rhs;
      }
      return value;
    }

    function parseTerm(): number {
      let value = parseFactor();
      for (;;) {
        skip();
        const ch = src[i];
        if (ch !== "*" && ch !== "/") break;
        i += 1;
        const rhs = parseFactor();
        value = ch === "*" ? value * rhs : rhs === 0 ? Number.NaN : value / rhs;
      }
      return value;
    }

    function parseFactor(): number {
      skip();
      if (src[i] === "-") {
        i += 1;
        return -parseFactor();
      }
      if (src[i] === "(") {
        i += 1;
        const value = parseExpr();
        skip();
        if (src[i] === ")") i += 1;
        return value;
      }
      const rest = src.slice(i);
      const fn = /^([A-Z]+)\(([^)]*)\)/i.exec(rest);
      if (fn) {
        i += fn[0].length;
        const name = fn[1].toUpperCase();
        const args = fn[2].trim();
        let values: number[] = [];
        if (!args) values = [];
        else if (/^[A-Z]+\d+:[A-Z]+\d+$/i.test(args)) {
          const [from, to] = args.split(":");
          values = rangeValues(from, to);
        } else {
          values = args.split(",").map((part) => {
            const p = part.trim();
            const ref = parseRef(p);
            return ref ? numberAt(ref.row, ref.col) : Number(p) || 0;
          });
        }
        if (name === "SUM") return values.reduce((a, b) => a + b, 0);
        if (name === "AVG" || name === "AVERAGE")
          return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        if (name === "MIN") return values.length ? Math.min(...values) : 0;
        if (name === "MAX") return values.length ? Math.max(...values) : 0;
        if (name === "COUNT") return values.length;
        return Number.NaN;
      }
      const num = /^\d+(\.\d+)?/.exec(rest);
      if (num) {
        i += num[0].length;
        return Number(num[0]);
      }
      const ref = /^[A-Z]+\d+/i.exec(rest);
      if (ref) {
        i += ref[0].length;
        const parsed = parseRef(ref[0]);
        return parsed ? numberAt(parsed.row, parsed.col) : Number.NaN;
      }
      i = src.length;
      return Number.NaN;
    }

    const result = parseExpr();
    return Number.isNaN(result) ? "#ERR" : result;
  }

  return rows.map((row, r) =>
    row.map((_, c) => {
      const raw = rawAt(r, c);
      if (!raw.startsWith("=")) return raw;
      const v = valueAt(r, c);
      return typeof v === "number" ? formatNumber(v) : v;
    }),
  );
}

/* ---------- 笔记内嵌：编辑原生表格 ---------- */

export type SheetMode = "file" | "inline";

let inlineApply: ((rows: SheetRows) => void) | null = null;

export function openInlineSheet(name: string, rows: SheetRows, apply: (rows: SheetRows) => void) {
  sheetStore.path = "";
  sheetStore.name = name;
  sheetStore.rows = normalize(rows.length ? rows : [[""]]);
  sheetStore.widths = loadWidths("inline", sheetStore.rows[0]?.length ?? 1);
  sheetStore.cursorRow = 0;
  sheetStore.cursorCol = 0;
  sheetStore.anchorRow = 0;
  sheetStore.anchorCol = 0;
  sheetStore.mode = "inline";
  inlineApply = apply;
  sheetStore.open = true;
}

export function closeInlineSheet() {
  inlineApply = null;
  sheetStore.mode = "file";
}

/* ---------- 多行 / 多列操作 ---------- */

export function selectedShape() {
  const r = selectionRange();
  return { rows: r.r1 - r.r0 + 1, cols: r.c1 - r.c0 + 1, top: r.r0, left: r.c0 };
}

export function insertRowsAt(index: number, count: number) {
  const rows = sheetStore.rows.map((row) => [...row]);
  const width = rows[0]?.length ?? 1;
  const block = Array.from({ length: count }, () => new Array(width).fill(""));
  rows.splice(Math.min(index, rows.length), 0, ...block);
  sheetStore.rows = normalize(rows);
}

export function insertColsAt(index: number, count: number) {
  const rows = sheetStore.rows.map((row) => {
    const next = [...row];
    next.splice(Math.min(index, next.length), 0, ...new Array(count).fill(""));
    return next;
  });
  sheetStore.rows = normalize(rows);
  sheetStore.widths.splice(
    Math.min(index, sheetStore.widths.length),
    0,
    ...new Array(count).fill(DEFAULT_COL_WIDTH),
  );
  saveWidths();
}

/** 至少保留一行/一列，避免整表被删空 */
export function deleteRowsAt(index: number, count: number) {
  const keep = Math.max(1, sheetStore.rows.length - count);
  const rows = sheetStore.rows.filter((_, i) => i < index || i >= index + count);
  sheetStore.rows = normalize(rows.slice(0, keep));
  setCursor(Math.min(index, sheetStore.rows.length - 1), sheetStore.cursorCol);
}

export function deleteColsAt(index: number, count: number) {
  const width = sheetStore.rows[0]?.length ?? 1;
  if (width <= count) return;
  sheetStore.rows = normalize(
    sheetStore.rows.map((row) => row.filter((_, i) => i < index || i >= index + count)),
  );
  sheetStore.widths.splice(index, count);
  saveWidths();
  setCursor(sheetStore.cursorRow, Math.min(index, (sheetStore.rows[0]?.length ?? 1) - 1));
}

/** 向下填充：选区首行的值复制到其余行（Excel 的 Ctrl+D） */
export function fillDown() {
  const r = selectionRange();
  if (r.r1 <= r.r0) return;
  const rows = sheetStore.rows.map((row) => [...row]);
  for (let col = r.c0; col <= r.c1; col += 1) {
    const value = rows[r.r0]?.[col] ?? "";
    for (let row = r.r0 + 1; row <= r.r1; row += 1) {
      if (rows[row]) rows[row][col] = value;
    }
  }
  sheetStore.rows = rows;
}

/** 向右填充：选区首列的值复制到其余列 */
export function fillRight() {
  const r = selectionRange();
  if (r.c1 <= r.c0) return;
  const rows = sheetStore.rows.map((row) => [...row]);
  for (let row = r.r0; row <= r.r1; row += 1) {
    const value = rows[row]?.[r.c0] ?? "";
    for (let col = r.c0 + 1; col <= r.c1; col += 1) {
      if (rows[row]) rows[row][col] = value;
    }
  }
  sheetStore.rows = rows;
}
