/**
 * 悬浮滚动条：隐藏原生滚动条占位，改用浮在编辑区右侧的细条。
 *
 * 目的：原生滚动条在滚动容器里会占掉右侧约 10px，sticky 工具栏只铺满内容区，
 * 于是工具栏右边露出一条底色 + 底边线断裂。改成 overlay 后没有占位，
 * 工具栏可以铺满整宽，滚动条只在滚动/悬停时浮现。
 */
export function attachOverlayScrollbar(root: HTMLElement): () => void {
  const shell = root.closest<HTMLElement>(".rich-editor") ?? root;

  const thumb = document.createElement("div");
  thumb.className = "md-overlay-scrollbar";
  shell.appendChild(thumb);

  let scroller: HTMLElement | null = null;
  let hideTimer = 0;
  let dragging = false;
  let dragStartY = 0;

  const TOP_INSET = 48;
  const BOTTOM_INSET = 8;

  function resolveScroller() {
    const next = shell.querySelector<HTMLElement>(".milkdown");
    if (next && next !== scroller) {
      scroller?.removeEventListener("scroll", onScroll);
      scroller = next;
      scroller.addEventListener("scroll", onScroll, { passive: true });
    }
  }

  function metrics() {
    if (!scroller) return null;
    const track = shell.clientHeight - TOP_INSET - BOTTOM_INSET;
    const scrollable = scroller.scrollHeight - scroller.clientHeight;
    if (track <= 0 || scrollable <= 2) return null;
    const height = Math.max(28, Math.round((scroller.clientHeight / scroller.scrollHeight) * track));
    const top = TOP_INSET + Math.round((scroller.scrollTop / scrollable) * (track - height));
    return { track, scrollable, height, top };
  }

  function render(show = false) {
    resolveScroller();
    const m = metrics();
    if (!m) {
      thumb.classList.remove("show");
      return;
    }
    thumb.style.height = `${m.height}px`;
    thumb.style.top = `${m.top}px`;
    if (show) reveal();
  }

  function reveal() {
    thumb.classList.add("show");
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (!dragging) thumb.classList.remove("show");
    }, 1200);
  }

  function onScroll() {
    render(true);
  }

  function onPointerDown(event: PointerEvent) {
    const m = metrics();
    if (!m) return;
    dragging = true;
    dragStartY = event.clientY;
    thumb.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging || !scroller) return;
    const m = metrics();
    if (!m) return;
    const usable = Math.max(1, m.track - m.height);
    const delta = ((event.clientY - dragStartY) / usable) * m.scrollable;
    scroller.scrollTop += delta;
    dragStartY = event.clientY;
    render(true);
  }

  function onPointerUp() {
    dragging = false;
  }

  function onEnter() {
    render(true);
    reveal();
  }

  thumb.addEventListener("pointerdown", onPointerDown);
  thumb.addEventListener("pointermove", onPointerMove);
  thumb.addEventListener("pointerup", onPointerUp);
  thumb.addEventListener("pointercancel", onPointerUp);
  shell.addEventListener("pointerenter", onEnter);

  const ro = new ResizeObserver(() => render());
  ro.observe(shell);
  if (root !== shell) ro.observe(root);

  render();
  const retry = window.setTimeout(() => render(), 500);

  return () => {
    window.clearTimeout(retry);
    window.clearTimeout(hideTimer);
    ro.disconnect();
    scroller?.removeEventListener("scroll", onScroll);
    shell.removeEventListener("pointerenter", onEnter);
    thumb.remove();
  };
}
