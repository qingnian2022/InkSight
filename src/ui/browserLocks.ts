/**
 * 关掉 WebView 自带的浏览器行为：F12 开发者工具、刷新、打印、缩放、
 * 原生右键菜单、图片拖拽。
 *
 * 这些在桌面应用里都是「露馅」的入口 —— 用户按 F5 会把整个界面重载，
 * Ctrl+滚轮会把布局缩放成另一个样子。应用自己的快捷键不受影响：
 * 这里只 preventDefault，不 stopPropagation，App 的 handler 照常跑。
 */

const BLOCKED_CTRL_KEYS = new Set(["r", "p", "f", "u", "+", "=", "-", "0"]);

export function installBrowserLocks() {
  window.addEventListener(
    "keydown",
    (event) => {
      const key = event.key.toLowerCase();

      // 开发者工具：F12 / Ctrl+Shift+I J C
      if (event.key === "F12" || (event.shiftKey && (event.ctrlKey || event.metaKey) && ["i", "j", "c"].includes(key))) {
        event.preventDefault();
        return;
      }

      // 浏览器级操作：刷新、打印、查找、查看源码、缩放
      if ((event.ctrlKey || event.metaKey) && !event.altKey && BLOCKED_CTRL_KEYS.has(key)) {
        event.preventDefault();
        return;
      }
      if (event.key === "F5" || event.key === "F3" || event.key === "F7") {
        event.preventDefault();
      }
    },
    { capture: true },
  );

  // Ctrl + 滚轮缩放
  window.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    },
    { passive: false, capture: true },
  );


  // 图片不能被拖出去生成一个「幽灵文件」
  window.addEventListener(
    "dragstart",
    (event) => {
      if (event.target instanceof HTMLImageElement) event.preventDefault();
    },
    { capture: true },
  );
}
