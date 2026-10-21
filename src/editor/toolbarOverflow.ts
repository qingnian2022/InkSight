/**
 * 工具栏「渐进收纳」：空间不够时把靠后的按钮收进 ⋯ 溢出菜单，
 * 空间恢复时自动放回去。
 *
 * - 直接移动 DOM 节点（不 clone），Crepe / 自绘按钮的事件都保留
 * - 菜单用 fixed 定位，不受工具栏 overflow 影响
 * - 分隔线（divider）随相邻按钮一起隐去，避免留下孤零零的空隙
 * - 布局是「先算目标集合、再一次性变更」，避免 ResizeObserver 震荡
 */
export interface ToolbarOverflowOptions {
  /** 可收纳的元素选择器（相对 row） */
  itemSelector: string;
  /** 分隔线选择器（可选） */
  dividerSelector?: string;
  /** 左侧永不收纳的元素数量（默认 1：标题按钮） */
  keepFirst?: number;
  /** 按钮与分隔线之间的间距（px），用于宽度估算 */
  gap?: number;
}

const GAP = 2;

export function attachToolbarOverflow(row: HTMLElement, opts: ToolbarOverflowOptions): () => void {
  const itemSelector = opts.itemSelector;
  const dividerSelector = opts.dividerSelector ?? "";
  const keepFirst = opts.keepFirst ?? 1;
  const gap = opts.gap ?? GAP;

  // ── ⋯ 按钮 ──
  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "toolbar-more";
  moreBtn.title = "更多命令";
  moreBtn.setAttribute("aria-label", "更多命令");
  moreBtn.innerHTML = "⋯";
  moreBtn.style.display = "none";

  // ── 溢出菜单（fixed 定位）──
  const menu = document.createElement("div");
  menu.className = "toolbar-more-menu";
  menu.style.display = "none";
  document.body.appendChild(menu);

  const closeMenu = () => {
    menu.style.display = "none";
  };
  const onDocPointerDown = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node) && e.target !== moreBtn) closeMenu();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeMenu();
  };

  moreBtn.addEventListener("click", () => {
    if (menu.style.display === "none") {
      const r = moreBtn.getBoundingClientRect();
      menu.style.display = "grid";
      const mw = menu.offsetWidth;
      const mh = menu.offsetHeight;
      const left = Math.min(r.right - mw, window.innerWidth - mw - 8);
      let top = r.bottom + 6;
      if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
      menu.style.left = `${Math.max(8, left)}px`;
      menu.style.top = `${top}px`;
    } else {
      closeMenu();
    }
  });
  document.addEventListener("pointerdown", onDocPointerDown);
  document.addEventListener("keydown", onKeyDown);

  // 挂载时的原始排列与宽度缓存（宽度以「在行内」时为准）
  const originalOrder: HTMLElement[] = Array.from(row.children).filter(
    (el) => el !== moreBtn && el !== menu,
  ) as HTMLElement[];
  const items: HTMLElement[] = Array.from(row.querySelectorAll<HTMLElement>(itemSelector));
  const widthOf = new Map<HTMLElement, number>();
  for (const el of items) widthOf.set(el, el.offsetWidth);

  /** 行可用宽度 = 父容器宽度 − 内边距 − 兄弟元素（如右侧按钮组）占位 */
  function availableWidth(): number {
    const parent = row.parentElement;
    if (!parent) return row.clientWidth;
    const pcs = getComputedStyle(parent);
    const pad = (parseFloat(pcs.paddingLeft) || 0) + (parseFloat(pcs.paddingRight) || 0);
    let siblings = 0;
    for (const el of Array.from(parent.children)) {
      if (el === row || el === moreBtn || el === menu) continue;
      const he = el as HTMLElement;
      if (he.style.display === "none" || he.tagName === "SCRIPT" || he.tagName === "STYLE") continue;
      siblings += he.offsetWidth + gap;
    }
    return parent.clientWidth - pad - siblings;
  }

  /** 算出「应收纳」的元素集合（只读，不改 DOM） */
  function computeHidden(): HTMLElement[] {
    const cs = getComputedStyle(row);
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const avail = Math.min(row.clientWidth, availableWidth()) - pad;
    if (avail <= 0) return [];

    let used = 0;
    for (let i = 0; i < items.length; i++) {
      const isKeep = i < keepFirst;
      const w = (widthOf.get(items[i]) ?? items[i].offsetWidth) + (i > 0 ? gap : 0);
      const reserve = isKeep ? 0 : moreBtn.offsetWidth || 30;
      if (used + w + reserve > avail) return items.slice(i);
      used += w;
    }
    return [];
  }

  /** 收纳后清理孤零零的分隔线 */
  function fixDividers(hidden: HTMLElement[]) {
    if (!dividerSelector) return;
    const dividers = Array.from(row.querySelectorAll<HTMLElement>(dividerSelector));
    for (const d of dividers) {
      const next = d.nextElementSibling as HTMLElement | null;
      const isLast = !next || next === moreBtn;
      const nextHidden = next ? hidden.includes(next) : true;
      d.style.display = isLast || nextHidden ? "none" : "";
    }
  }

  /** 一次性应用目标状态；无变化就不动 DOM（防震荡） */
  function apply() {
    if (!row.isConnected) return;
    const hidden = computeHidden();
    const inMenu = new Set(Array.from(menu.children) as HTMLElement[]);
    const changed =
      hidden.length !== inMenu.size || hidden.some((el) => !inMenu.has(el));

    if (!changed) return;

    // 按原始顺序重建：先全部回行，再把目标集合移进菜单
    for (const el of originalOrder) row.appendChild(el);
    if (hidden.length) {
      for (const el of hidden) menu.appendChild(el);
      row.appendChild(moreBtn);
      moreBtn.style.display = "";
    } else {
      moreBtn.style.display = "none";
      closeMenu();
    }
    for (const el of items) el.style.display = "";
    fixDividers(hidden);
  }

  let raf = 0;
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(apply);
  };

  const ro = new ResizeObserver(schedule);
  ro.observe(row);
  if (row.parentElement) ro.observe(row.parentElement);
  window.addEventListener("resize", schedule);

  // 首帧在字体/图标就位后测量
  schedule();
  setTimeout(schedule, 60);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener("resize", schedule);
    document.removeEventListener("pointerdown", onDocPointerDown);
    document.removeEventListener("keydown", onKeyDown);
    // 恢复原始顺序
    for (const el of originalOrder) row.appendChild(el);
    for (const el of items) el.style.display = "";
    if (dividerSelector) {
      for (const d of Array.from(row.querySelectorAll<HTMLElement>(dividerSelector))) {
        d.style.display = "";
      }
    }
    moreBtn.remove();
    menu.remove();
  };
}
