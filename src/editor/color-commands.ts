import { editorViewCtx } from "@milkdown/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { reactive } from "vue";
import { coloredTextSchema } from "./inline-html";

/**
 * 顶部工具栏「文字颜色」：仿语雀拆成两个按钮——
 * - A（带彩色下划线）：点击直接用「最近使用的颜色」给选中文字染色；
 * - 小箭头 ▾：弹出语雀式大色板（默认行 + 10 灰阶 + 4 行 × 10 色相）。
 *
 * 下划线颜色跟随最近使用的颜色（CSS 变量 --md-rust-last-color）。
 * 数据仍是 coloredText 内联节点，序列化回 <font style="color:...">。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ColorOption {
  label: string;
  value: string;
}

/** 色板第一行「默认」：恢复正文颜色（= 清除染色） */
export const COLOR_DEFAULT_LABEL = "默认";

/** 灰阶行：黑 → 白 共 10 档 */
export const COLOR_GRAY_ROW: ColorOption[] = [
  { label: "黑色", value: "#000000" },
  { label: "深灰", value: "#262626" },
  { label: "灰色", value: "#595959" },
  { label: "中灰", value: "#8c8c8c" },
  { label: "浅灰", value: "#bfbfbf" },
  { label: "银灰", value: "#d9d9d9" },
  { label: "雾灰", value: "#e8e8e8" },
  { label: "浅白", value: "#f2f2f2" },
  { label: "灰白", value: "#fafafa" },
  { label: "白色", value: "#ffffff" },
];

/** 4 行 × 10 色相：标准 / 浅 / 淡 / 深 */
export const COLOR_HUE_ROWS: ColorOption[][] = [
  [
    { label: "红色", value: "#f5493d" },
    { label: "橙色", value: "#fb8b2a" },
    { label: "黄色", value: "#ffc21c" },
    { label: "黄绿", value: "#a8cf12" },
    { label: "绿色", value: "#34c724" },
    { label: "青色", value: "#13c2c2" },
    { label: "蓝色", value: "#2f7cf6" },
    { label: "靛蓝", value: "#4a3ff0" },
    { label: "紫色", value: "#9254de" },
    { label: "品红", value: "#eb2f96" },
  ],
  [
    { label: "浅红", value: "#fab0a8" },
    { label: "浅橙", value: "#fdc9a0" },
    { label: "浅黄", value: "#ffe598" },
    { label: "浅黄绿", value: "#d6e993" },
    { label: "浅绿", value: "#a2e69c" },
    { label: "浅青", value: "#91e6e6" },
    { label: "浅蓝", value: "#a0c3fa" },
    { label: "浅靛", value: "#ada9f8" },
    { label: "浅紫", value: "#cdb2f0" },
    { label: "浅粉", value: "#f69fcf" },
  ],
  [
    { label: "淡红", value: "#fcd1ce" },
    { label: "淡橙", value: "#fde2c9" },
    { label: "淡黄", value: "#ffefc6" },
    { label: "淡黄绿", value: "#e9f3c3" },
    { label: "淡绿", value: "#ccf1c8" },
    { label: "淡青", value: "#c4efef" },
    { label: "淡蓝", value: "#cbdefd" },
    { label: "淡靛", value: "#d1cffb" },
    { label: "淡紫", value: "#e3d3f6" },
    { label: "淡粉", value: "#facbe5" },
  ],
  [
    { label: "深红", value: "#9f2f28" },
    { label: "深橙", value: "#a35a1b" },
    { label: "深黄", value: "#a67e12" },
    { label: "深黄绿", value: "#6d870c" },
    { label: "深绿", value: "#228117" },
    { label: "深青", value: "#0c7e7e" },
    { label: "深蓝", value: "#1f51a0" },
    { label: "深靛", value: "#30299c" },
    { label: "深紫", value: "#5f3790" },
    { label: "深品红", value: "#991f62" },
  ],
];

/** A 按钮使用的「最近颜色」初始值 */
export const DEFAULT_COLOR = COLOR_HUE_ROWS[0][0].value;

/** 色板弹层状态（ColorPalette.vue 消费） */
export const colorPaletteState = reactive({
  open: false,
  /** 最近一次使用的颜色（A 按钮直接染这个色） */
  last: DEFAULT_COLOR,
});

export function toggleColorPalette() {
  colorPaletteState.open = !colorPaletteState.open;
}

export function closeColorPalette() {
  colorPaletteState.open = false;
}

/** 最近使用颜色写进 CSS 变量，A 按钮下划线随之变色 */
function markLastUsed(color: string) {
  colorPaletteState.last = color;
  document.documentElement.style.setProperty("--md-rust-last-color", color);
  closeColorPalette();
}

/** A 按钮图标：字母 A + 彩色下划线（下划线色走 CSS 变量） */
export const COLOR_ICON = `<svg class="md-rust-color-glyph" width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
  <text x="10" y="13.5" text-anchor="middle" font-size="13" font-weight="600" fill="currentColor">A</text>
  <rect x="3.5" y="16" width="13" height="2.5" rx="1.25" style="fill: var(--md-rust-last-color, ${DEFAULT_COLOR})" />
</svg>`;

/** 色板按钮图标：小下拉箭头 */
export const COLOR_CHEVRON_ICON = `<svg class="md-rust-color-chevron" width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
  <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
</svg>`;

/** 定位 TopBar 里的 A 按钮（供弹层定位用） */
export function locateColorButton(): HTMLElement | null {
  const glyph = document.querySelector(".md-rust-color-glyph");
  return glyph?.closest("button") ?? null;
}

function findColoredAncestor($pos: any): { node: any; from: number; to: number } | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (node.type.name === "coloredText") {
      return { node, from: $pos.before(depth), to: $pos.after(depth) };
    }
  }
  return null;
}

/** 光标当前所在的彩色文字颜色（不在则返回空串 = 默认色）。 */
export function currentColor(ctx: Ctx): string {
  const view = ctx.get(editorViewCtx);
  const hit = findColoredAncestor(view.state.selection.$from);
  return hit?.node.attrs.color ?? "";
}

/** 给选中内容上色；若选区已在彩色文字内，改为修改该段颜色。 */
export function applyColor(ctx: Ctx, color: string) {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const sel = state.selection;
  const fromHit = findColoredAncestor(sel.$from);
  const toHit = findColoredAncestor(sel.$to);
  const sameNode =
    fromHit && toHit && fromHit.from === toHit.from && sel.from >= fromHit.from && sel.to <= fromHit.to;

  if (sameNode) {
    if (fromHit!.node.attrs.color !== color) {
      // 改色时保留原有背景色
      view.dispatch(
        state.tr.setNodeMarkup(fromHit!.from, null, {
          color,
          background: fromHit!.node.attrs.background ?? "",
        }),
      );
      view.focus();
    }
    markLastUsed(color);
    return;
  }

  // 光标没有选区，又不在彩色文字内 → 无从上色
  if (sel.empty) return;

  // 跨块选择暂不支持（表格/多段落）
  if (!sel.$from.sameParent(sel.$to)) return;

  const nodeType = coloredTextSchema.type(ctx);

  // 先拆掉选区里已存在的彩色文字（否则会套娃：<font><font>…）
  const tr = state.tr;
  const existing: { from: number; to: number; content: any }[] = [];
  state.doc.nodesBetween(sel.from, sel.to, (node, pos) => {
    if (node.type.name !== "coloredText") return true;
    if (pos >= sel.from && pos + node.nodeSize <= sel.to) {
      existing.push({ from: pos, to: pos + node.nodeSize, content: node.content });
      return false;
    }
    return true;
  });
  for (const item of existing.reverse()) tr.replaceWith(item.from, item.to, item.content);

  const from = tr.mapping.map(sel.from, -1);
  const to = tr.mapping.map(sel.to, 1);
  const slice = tr.doc.slice(from, to);
  const node = nodeType.create({ color }, slice.content);
  view.dispatch(tr.replaceWith(from, to, node));
  view.focus();
  markLastUsed(color);
}

/** 清除光标所在彩色文字的颜色（内容保留，变回普通文字）。 */
export function clearColor(ctx: Ctx) {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const sel = state.selection;
  const hit = findColoredAncestor(sel.$from);
  if (hit && sel.from >= hit.from && sel.to <= hit.to) {
    view.dispatch(state.tr.replaceWith(hit.from, hit.to, hit.node.content));
    view.focus();
  }
  closeColorPalette();
}

/**
 * TopBar 的两个按钮（语雀式拆分）：
 * - A：直接用最近颜色染色；
 * - ▾：开 / 关色板弹层。
 */
export function buildColorTopBarItems() {
  return [
    {
      key: "font-color-apply",
      icon: COLOR_ICON,
      active: (ctx: Ctx) => !!currentColor(ctx),
      onRun: (ctx: Ctx) => applyColor(ctx, colorPaletteState.last),
    },
    {
      key: "font-color-menu",
      icon: COLOR_CHEVRON_ICON,
      active: () => colorPaletteState.open,
      onRun: () => toggleColorPalette(),
    },
  ];
}
