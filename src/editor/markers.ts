/** 提示块 / 折叠块共用的首行标记：同一段里只允许存在一个，插入时互相替换而不是叠加。 */
export const ANY_MARKER_RE = /\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|FOLD)\]/i;

export function markerText(kind: "note" | "tip" | "important" | "warning" | "caution" | "fold"): string {
  return `[!${kind.toUpperCase()}] `;
}
