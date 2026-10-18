import { reactive } from "vue";

/** 自定义右键菜单的全局状态：任意组件都能打开它。 */
export interface CtxItem {
  label?: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  /** 为 true 时渲染成分隔线 */
  separator?: boolean;
}

export const ctxState = reactive({
  open: false,
  x: 0,
  y: 0,
  items: [] as CtxItem[],
});

export function openContextMenu(x: number, y: number, items: CtxItem[]) {
  ctxState.x = x;
  ctxState.y = y;
  ctxState.items = items;
  ctxState.open = true;
}

export function closeContextMenu() {
  ctxState.open = false;
}
