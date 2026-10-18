/**
 * 开发预览入口（浏览器里看 UI 用，不参与 tauri 构建）：
 *   npx vite 后访问 /preview.html
 *   ?theme=dark 深色   ?outline=1 大纲   ?novault=1 空库
 *   ?menu=1 打开右键菜单（真实事件链路）：
 *     无 target  → 编辑器内（编辑动作菜单）
 *     target=body        → 应用菜单
 *     target=file        → 目录树文件节点菜单
 *     target=dir         → 目录树文件夹节点菜单
 *     target=tree-empty  → 目录树空白区域菜单
 *   ?prompt=1 命名弹窗   ?scroll=1 滚到底
 */
import { createApp, h } from "vue";
import App from "./App.vue";
import { setAutoSave, setEditorWidth, state } from "./store";
import { openNamePrompt } from "./ui/namePrompt";
import "./styles/tokens.css";
import "./styles/app.css";

const q = new URLSearchParams(location.search);
// 把运行时错误写进 title，headless dump-dom 可以直接读
window.addEventListener("error", (e) => {
  document.title = "ERR:" + e.message + " | " + (e.error?.stack ?? "").slice(0, 1600);
});
window.addEventListener("unhandledrejection", (e) => {
  document.title = "REJ:" + String((e as PromiseRejectionEvent).reason);
});
const dark = q.get("theme") === "dark";
localStorage.setItem("md-rust.theme", dark ? "dark" : "light");
document.documentElement.dataset.theme = dark ? "dark" : "light";
// ?accent=%230f5a8a —— 临时换主色，用于候选配色对比；不落盘
const accent = q.get("accent");
if (accent) document.documentElement.style.setProperty("--accent", decodeURIComponent(accent));

const doc = `# 写作工作台

把碎片记下来，再慢慢长出结构。这个知识库就是一个普通文件夹，没有数据库，也没有锁定格式。

## 今天的想法

- **先写，再整理**：不要在写第一段的时候就想目录
- 引用要能追溯来源，链接比摘要更可靠

> 写作不是表达已经想清楚的东西，而是想清楚的过程。

## 素材

| 主题 | 来源 | 状态 |
|---|---|---|
| 卡片笔记 | 《How to Take Smart Notes》 | 在读 |
| 认知负荷 | Nielsen Norman Group | 已读 |

\`\`\`ts
type Note = { id: string; title: string };

export function wordCount(note: Note) {
  return note.title.length;
}
\`\`\`
`;

state.root = "D:/Notes/知识库";
state.tree = [
  { name: "写作", path: "D:/Notes/知识库/写作", isDir: true, children: [
    { name: "写作工作台", path: "D:/Notes/知识库/写作/写作工作台.md", isDir: false },
    { name: "卡片笔记法", path: "D:/Notes/知识库/写作/卡片笔记法.md", isDir: false },
  ]},
  { name: "读书清单", path: "D:/Notes/知识库/读书清单.md", isDir: false },
];
state.expanded = new Set(["D:/Notes/知识库/写作"]);
state.tabs = [
  { path: "D:/Notes/知识库/写作/写作工作台.md", name: "写作工作台", content: doc, dirty: true },
];
state.activePath = "D:/Notes/知识库/写作/写作工作台.md";
state.readonly = false;
state.editorMode = "rich";
state.charCount = 684;
state.saveState = "dirty";

createApp({ render: () => h(App) }).mount("#app");

// —— 以下都要在 mount 之后执行 ——

/** 在指定元素上派发真实的 contextmenu，走 App.vue 的完整分发逻辑 */
function fireAt(el: Element | null, offsetX = 40, offsetY = 12) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  el.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + offsetX),
      clientY: Math.round(rect.top + offsetY),
    }),
  );
}

if (q.get("outline") === "1") state.outlineOpen = true;
if (q.get("as") === "0") setAutoSave(false);
if (q.get("new") === "1") {
  state.tabs.unshift({ path: "::untitled-1", name: "未命名", content: "", dirty: true });
  state.activePath = "::untitled-1";
  state.saveState = "dirty";
  state.charCount = 0;
  setTimeout(() => {
    void openNamePrompt({
      title: "保存新文档",
      initial: "未命名",
      confirmText: "保存",
      folder: "D:/Notes/知识库/写作",
    });
  }, 1600);
}
if (q.get("mode") === "source") {
  state.editorMode = "source";
  state.readonly = true;
}
if (q.get("wp") === "1") {
  setTimeout(() => {
    document.querySelector<HTMLButtonElement>(".wp-btn")?.click();
  }, 1500);
}
// ?hd=1 —— 打开顶栏「标题」下拉（Crepe 监听 pointerdown，不能用 click()）
if (q.get("hd") === "1") {
  const tryHd = (n: number) => {
    const btn = document.querySelector<HTMLElement>(".top-bar-heading-button");
    if (!btn) {
      if (n > 0) setTimeout(() => tryHd(n - 1), 400);
      return;
    }
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  };
  tryHd(30);
}
// ?wpk=narrow|standard|wide|full —— 挂载前直接切列宽，验证宽度真实生效
const wpk = q.get("wpk");
if (wpk === "narrow" || wpk === "wide" || wpk === "full") setEditorWidth(wpk);
if (q.get("novault") === "1") {
  state.root = ""; state.tree = []; state.tabs = []; state.activePath = "";
  state.charCount = 0; state.saveState = "saved";
}

if (q.get("menu") === "1") {
  const target = q.get("target") ?? "";
  if (target === "body") {
    fireAt(document.querySelector(".main"), 200, 60);
  } else if (target === "file") {
    fireAt(document.querySelector('.tree-row[data-path$="读书清单.md"]'));
  } else if (target === "dir") {
    fireAt(document.querySelector('.tree-row[data-path$="知识库/写作"]'));
  } else if (target === "tree-empty") {
    fireAt(document.querySelector(".tree"), 60, 320);
  } else {
    // 编辑器内：ProseMirror 可能异步挂载，轮询等待
    const tryDispatch = (n: number) => {
      const pm = document.querySelector(".ProseMirror");
      if (!pm) {
        if (n > 0) setTimeout(() => tryDispatch(n - 1), 400);
        return;
      }
      fireAt(pm, 200, 120);
    };
    tryDispatch(30);
  }
}

if (q.get("prompt") === "1") {
  void openNamePrompt({ title: "新建文档", initial: "未命名" });
}

if (q.get("scroll") === "1") {
  setTimeout(() => {
    const el = document.querySelector(".milkdown") as HTMLElement | null;
    if (el) el.scrollTop = el.scrollHeight;
  }, 1600);
}

setInterval(() => { state.error = ""; if (state.saveState === "error") state.saveState = "dirty"; }, 400);
