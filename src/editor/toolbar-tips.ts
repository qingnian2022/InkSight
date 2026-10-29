/**
 * 工具栏按钮的功能提示（语雀式深色 tooltip）。
 *
 * Crepe 的图标按钮不带文字说明，这里按工具栏固定顺序补上中文标签，
 * 鼠标悬停 / 键盘聚焦时在按钮下方弹出说明。
 * 标签挂在 data-tip 上，溢出收纳时节点整体移动，提示仍然有效。
 */

/** 与 buildTopBar 里的顺序一一对应（标题按钮不算） */
const ITEM_LABELS = [
  "加粗",
  "斜体",
  "删除线",
  "字体颜色",
  "选择颜色",
  "无序列表",
  "有序列表",
  "任务列表",
  "链接",
  "图片",
  "表格",
  "行内代码",
  "代码块",
  "公式",
  "引用",
  "分割线",
];

export function attachToolbarTips(root: HTMLElement): () => void {
  const items = Array.from(root.querySelectorAll<HTMLElement>(".top-bar-item"));
  items.forEach((el, index) => {
    const label = ITEM_LABELS[index];
    if (!label) return;
    if (!el.dataset.tip) el.dataset.tip = label;
    if (!el.getAttribute("aria-label")) el.setAttribute("aria-label", label);
  });

  const heading = root.querySelector<HTMLElement>(".top-bar-heading-button");
  if (heading) {
    if (!heading.dataset.tip) heading.dataset.tip = "段落样式";
    if (!heading.getAttribute("aria-label")) heading.setAttribute("aria-label", "段落样式");
  }

  const tip = document.createElement("div");
  tip.className = "tb-tip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);

  let current: HTMLElement | null = null;
  let timer = 0;

  const hide = () => {
    window.clearTimeout(timer);
    current = null;
    tip.classList.remove("show");
  };

  const show = (el: HTMLElement) => {
    const text = el.dataset.tip;
    if (!text) return;
    current = el;
    tip.textContent = text;
    tip.classList.add("show");
    const r = el.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const left = Math.round(Math.min(Math.max(8, r.left + r.width / 2 - tr.width / 2), window.innerWidth - tr.width - 8));
    const top = Math.round(r.bottom + 8);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  const onOver = (event: Event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-tip]");
    if (!target || target === current) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => show(target), 260);
  };

  const onOut = (event: Event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-tip]");
    if (!target) return;
    const related = (event as PointerEvent).relatedTarget as Node | null;
    if (related && target.contains(related)) return;
    hide();
  };

  document.addEventListener("pointerover", onOver, true);
  document.addEventListener("pointerout", onOut, true);
  document.addEventListener("pointerdown", hide, true);
  window.addEventListener("blur", hide);

  return () => {
    hide();
    document.removeEventListener("pointerover", onOver, true);
    document.removeEventListener("pointerout", onOut, true);
    document.removeEventListener("pointerdown", hide, true);
    window.removeEventListener("blur", hide);
    tip.remove();
  };
}
