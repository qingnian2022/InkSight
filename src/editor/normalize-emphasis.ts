import { $remark } from "@milkdown/kit/utils";
import { fixInlineTree } from "./emphasis-rules.js";

/**
 * 强调（加粗）归一化 remark 插件。
 *
 * 背景：CommonMark 规定 `**` 的闭合位置（right-flanking），中文写作里
 * `**标题。**正文` 这种「闭合星号紧贴中文标点」的写法会被判定为不能闭合，
 * 于是原样显示星号。规则细节见 `emphasis-rules.js`（与诊断脚本共用同一份实现）。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const normalizeEmphasis = $remark("normalizeEmphasis", () => () => (tree: any) => {
  fixInlineTree(tree);
});
