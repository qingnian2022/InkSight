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
const GAP = 4.2;
/** 描边半宽（视觉宽度 = 该值 × 2） */
const strokeHalf = 1.5;
/** 左侧留白：描边半径 + 余量，避免首字母外沿被 viewBox 裁掉 */
const LEFT_PAD = strokeHalf + 0.6;
const COLORS = ["#1b1d1c", "#f09048", "#17b5ce", "#003060", "#f09048", "#1b1d1c", "#17b5ce", "#003060"];

const font = hershey.getFontData(FONT);

function parseSubpaths(d) {
  const subs = [];
  let cur = null;
  for (const tk of d.split(" ")) {
    const withCmd = tk.match(/^([ML])(-?[\d.]+),(-?[\d.]+)$/);
    if (withCmd) {
      const pt = { x: Number(withCmd[2]), y: Number(withCmd[3]) };
      if (withCmd[1] === "M") {
        cur = [pt];
        subs.push(cur);
      } else if (cur) {
        cur.push(pt);
      }
      continue;
    }
    const pair = tk.match(/^(-?[\d.]+),(-?[\d.]+)$/);
    if (pair && cur) cur.push({ x: Number(pair[1]), y: Number(pair[2]) });
  }
  return subs.filter((sub) => sub.length > 1);
}

/** 折线 → 二次贝塞尔（中点法）：圆角但不产生 Catmull-Rom 那种回头套圈 */
function smoothPath(points, dx = 0) {
  const p = points.map((pt) => ({ x: pt.x + dx, y: pt.y }));
  const f = (v) => v.toFixed(2);
  if (p.length < 3) {
    return p.map((pt, i) => `${i === 0 ? "M" : "L"}${f(pt.x)},${f(pt.y)}`).join(" ");
  }
  let out = `M${f(p[0].x)},${f(p[0].y)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i].x + p[i + 1].x) / 2;
    const my = (p[i].y + p[i + 1].y) / 2;
    out += ` Q${f(p[i].x)},${f(p[i].y)} ${f(mx)},${f(my)}`;
  }
  const last = p[p.length - 1];
  out += ` Q${f(last.x)},${f(last.y)} ${f(last.x)},${f(last.y)}`;
  return out;
}

function inkBounds(subs) {
  const xs = subs.flat().map((p) => p.x);
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
  const subs = parseSubpaths(glyph.d);
  const bounds = inkBounds(subs);
  const d = subs.map((sub) => smoothPath(sub, -bounds.minX)).join(" ");
  glyphs.push({ ch, d, inkW: bounds.w, x: cursor + LEFT_PAD, color: COLORS[i] });
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

minY = Math.floor(minY - strokeHalf - 0.6);
maxY = Math.ceil(maxY + strokeHalf + 0.6);
const height = maxY - minY;
const width = Math.ceil(cursor - GAP + LEFT_PAD + strokeHalf);

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
