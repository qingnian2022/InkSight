/**
 * 一次性生成 BootSplash 手写路径数据（Hershey Script 单线字体）。
 * 用字形墨迹宽度排版（Hershey JSON 里的 advance 与墨迹不一致，会导致字母互相压叠）。
 * 运行：node scripts/gen-ink-glyphs.mjs
 * 输出：src/components/inkGlyphs.ts + scripts/ink-glyphs-data.js
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const hershey = require("hersheytext");

const TEXT = "InkSight";
const FONT = "cursive";
/** 字母间留白（连接笔画的间隙，0=紧连） */
const GAP = 1.1;
const COLORS = ["#1b1d1c", "#f09048", "#17b5ce", "#003060", "#f09048", "#1b1d1c", "#17b5ce", "#003060"];

const font = hershey.getFontData(FONT);

function parsePts(d) {
  const pts = [];
  for (const tk of d.split(" ")) {
    const withCmd = tk.match(/^([ML])(-?[\d.]+),(-?[\d.]+)$/);
    if (withCmd) {
      pts.push({ x: Number(withCmd[2]), y: Number(withCmd[3]) });
      continue;
    }
    const pair = tk.match(/^(-?[\d.]+),(-?[\d.]+)$/);
    if (pair) pts.push({ x: Number(pair[1]), y: Number(pair[2]) });
  }
  return pts;
}

function shiftD(d, dx) {
  return parsePts(d)
    .map((pt, i) => {
      const cmd = i === 0 || /M/.test(d.split(" ")[i]) ? "M" : "L";
      return cmd + (pt.x + dx).toFixed(2) + "," + pt.y;
    })
    .join(" ");
}

function inkBounds(d) {
  const pts = parsePts(d);
  const xs = pts.map((p) => p.x);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), w: Math.max(...xs) - Math.min(...xs) };
}

const glyphs = [];
let cursor = 0;
let minY = Infinity;
let maxY = -Infinity;

for (let i = 0; i < TEXT.length; i++) {
  const ch = TEXT[i];
  const glyph = font.getChar(ch);
  if (!glyph || !glyph.d) throw new Error(`字符缺字形: ${ch}`);
  const bounds = inkBounds(glyph.d);
  const d = shiftD(glyph.d, -bounds.minX);
  glyphs.push({ ch, d, inkW: bounds.w, x: cursor, color: COLORS[i] });
  cursor += bounds.w + GAP;
  minY = Math.min(minY, bounds.minY ?? Infinity);
}

// y 范围（含 g 的降部）
for (const g of glyphs) {
  const nums = g.d.match(/-?\d+(?:\.\d+)?/g) ?? [];
  for (let i = 1; i < nums.length; i += 2) {
    const y = Number(nums[i]);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
}

const strokeHalf = 0.68;
minY = Math.floor(minY - strokeHalf);
maxY = Math.ceil(maxY + strokeHalf);
const height = maxY - minY;
const width = Math.ceil(cursor - GAP + strokeHalf);

const body = glyphs
  .map((g) => `  { ch: ${JSON.stringify(g.ch)}, d: ${JSON.stringify(g.d)}, x: ${Number(g.x.toFixed(2))}, color: ${JSON.stringify(g.color)} },`)
  .join("\n");

const out = `// 由 scripts/gen-ink-glyphs.mjs 生成（Hershey Script 单线字体，按墨迹宽度排版），请勿手改
export interface InkGlyph {
  ch: string;
  d: string;
  x: number;
  color: string;
}

export const INK_GLYPHS: InkGlyph[] = [
${body}
];

export const INK_VIEWBOX = {
  width: ${width},
  top: ${minY},
  height: ${height},
};

export const INK_STROKE_WIDTH = ${strokeHalf * 2};
`;

writeFileSync("src/components/inkGlyphs.ts", out);
writeFileSync(
  "scripts/ink-glyphs-data.js",
  "window.INK_GLYPHS_JSON = " + JSON.stringify(glyphs.map((g) => ({ ...g }))) + ";\n" +
  "window.INK_VIEWBOX_JSON = " + JSON.stringify({ width, top: minY, height }) + ";\n"
);
console.log(`written: ${glyphs.length} glyphs, viewBox ${width}x${height} (top ${minY})`);
