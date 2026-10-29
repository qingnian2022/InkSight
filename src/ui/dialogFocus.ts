/** 弹层键盘闭环：初始焦点 + Tab 循环 + 关闭后焦点归还（Esc 由各组件自己处理）。 */
export function trapFocus(container: HTMLElement): () => void {
  const selector =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const items = Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => el.offsetParent !== null,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inside = active ? container.contains(active) : false;
    if (event.shiftKey && (!inside || active === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (!inside || active === last)) {
      event.preventDefault();
      first.focus();
    }
  };

  document.addEventListener("keydown", onKey, true);
  return () => document.removeEventListener("keydown", onKey, true);
}

/** 记录打开弹层前的焦点，关闭时还回去 */
export function rememberFocus(): () => void {
  const prev = document.activeElement as HTMLElement | null;
  return () => {
    if (prev && document.contains(prev)) prev.focus();
  };
}
