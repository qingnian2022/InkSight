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
import { getPmCtx } from "./editor/pmCtxRef";
import { insertAtBoundary, runTableCmd } from "./editor/tableCmds";
import { editorViewCtx } from "@milkdown/core";
import { NodeSelection, TextSelection } from "@milkdown/prose/state";
// 直接拿 ProseMirror 视图实例做编程式选区（绕开 headless 无法真实点击的限制）

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
// ?tb=1 —— 表格交互诊断：NodeSelection（点击单元格后的真实状态）→ 插行 →
// 边界插列 → 删行，逐步报告命令是否真实生效
if (q.get("tb") === "1") {
  setTimeout(() => {
    const cell = document.querySelector<HTMLElement>(".milkdown-table-block tbody td");
    if (!cell) {
      const p = document.createElement("pre");
      p.textContent = "no table cell found";
      p.style.cssText = "position:fixed;right:6px;bottom:30px;background:#fff;color:#000;font:11px monospace;padding:4px;z-index:99999;border:1px solid #ccc";
      document.body.appendChild(p);
      return;
    }

    const blockEl = () => document.querySelector(".milkdown-table-block");
    const rowsIn = () => blockEl()?.querySelectorAll("tbody tr").length ?? -1;
    const colsIn = () => blockEl()?.querySelector("tr")?.children.length ?? -1;
    const results: string[] = [];

    const finish = () => {
      // 截图用：把光标真实放进第一个数据单元格（DOM 选区 + 输入），
      // 让工具条与「+」插入点走完整显示链路
      setTimeout(() => {
        const para = document.querySelector<HTMLElement>(".milkdown-table-block tbody tr:nth-child(2) td p");
        const pmEl = document.querySelector<HTMLElement>(".ProseMirror");
        pmEl?.focus();
        if (para) {
          const range = document.createRange();
          range.setStart(para.firstChild ?? para, 0);
          range.collapse(true);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          document.execCommand("insertText", false, "测");
        }
        setTimeout(() => {
          const tbEl = document.querySelector<HTMLElement>(".tbl-toolbar");
          results.push(
            "toolbar=" + (tbEl ? "shown" : "none") + " plus=" + document.querySelectorAll(".tbl-plus").length,
          );
          const probe = document.createElement("pre");
          probe.id = "tb-probe";
          probe.textContent = results.join("\n");
          probe.style.cssText = "position:fixed;left:6px;bottom:30px;background:#fff;color:#000;font:10px monospace;padding:4px;z-index:99999;border:1px solid #ccc;white-space:pre-wrap;max-width:560px";
          document.body.appendChild(probe);
        }, 900);
      }, 200);
    };

    // 步骤 3：删行（先把光标放进第 2 个数据行单元格，再删当前行 -1）
    const step3 = () => {
      const view = getPmCtx()?.get(editorViewCtx);
      const cell2 = document.querySelector<HTMLElement>(
        ".milkdown-table-block tbody tr:nth-child(3) td, .milkdown-table-block tbody tr:nth-child(3) th",
      );
      if (!view || !cell2) {
        results.push("delRow=skip(no-view-or-cell)");
        finish();
        return;
      }
      const inner = view.posAtDOM(cell2, 0);
      view.dispatch(
        view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(inner), 1)),
      );
      const before = rowsIn();
      const ok = runTableCmd("delRow");
      setTimeout(() => {
        const after = rowsIn();
        results.push("delRow=" + String(ok) + " rows=" + before + "->" + after + (after < before ? " OK" : " 未生效"));
        finish();
      }, 400);
    };

    // 步骤 2b：第 1 个数据行之前插行（行边界「+」路径）
    const step2b = () => {
      const before = rowsIn();
      const ok = insertAtBoundary("row", 1);
      setTimeout(() => {
        const after = rowsIn();
        results.push("boundaryRow=" + String(ok) + " rows=" + before + "->" + after + (after > before ? " OK" : " 未生效"));
        step3();
      }, 400);
    };

    // 步骤 2：第 1 列左侧插列（边界「+」路径）
    const step2 = () => {
      const before = colsIn();
      const ok = insertAtBoundary("col", 1);
      setTimeout(() => {
        const after = colsIn();
        results.push("boundaryCol=" + String(ok) + " cols=" + before + "->" + after + (after > before ? " OK" : " 未生效"));
        step2b();
      }, 400);
    };

    // 步骤 1：把选区改成 NodeSelection（复刻 Crepe 点击单元格后的状态），再插行
    const step1 = () => {
      const view = getPmCtx()?.get(editorViewCtx);
      if (!view) {
        results.push("no-pm-view");
        finish();
        return;
      }
      const inner = view.posAtDOM(cell, 0);
      const $pos = view.state.doc.resolve(inner);
      const cellStart = $pos.before($pos.depth);
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, cellStart)));
      const before = rowsIn();
      const ok = runTableCmd("rowAfter");
      setTimeout(() => {
        const after = rowsIn();
        results.push("nodeSelRowAfter=" + String(ok) + " rows=" + before + "->" + after + (after > before ? " OK" : " 未生效"));
        step2();
      }, 400);
    };

    step1();
  }, 2600);
}

// ?tb=2 —— 表格诊断第二组：删列、删表格
if (q.get("tb") === "2") {
  setTimeout(() => {
    const results: string[] = [];
    const blockEl = () => document.querySelector(".milkdown-table-block");
    const colsIn = () => blockEl()?.querySelector("tr")?.children.length ?? -1;

    const finish = () => {
      const probe = document.createElement("pre");
      probe.id = "tb-probe";
      probe.textContent = results.join("\n");
      probe.style.cssText = "position:fixed;left:6px;bottom:30px;background:#fff;color:#000;font:10px monospace;padding:4px;z-index:99999;border:1px solid #ccc;white-space:pre-wrap;max-width:560px";
      document.body.appendChild(probe);
    };

    const putCursor = (rowIdx: number, colIdx: number) => {
      const view = getPmCtx()?.get(editorViewCtx);
      const cell = blockEl()?.querySelectorAll("tr")[rowIdx]?.children[colIdx] as HTMLElement | undefined;
      if (!view || !cell) return false;
      const inner = view.posAtDOM(cell, 0);
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(inner), 1)));
      return true;
    };

    // 步骤 1：删列（光标在第 1 数据行第 1 列 → 删列 -1）
    const step1 = () => {
      putCursor(2, 1);
      const before = colsIn();
      const ok = runTableCmd("delCol");
      setTimeout(() => {
        const after = colsIn();
        results.push("delCol=" + String(ok) + " cols=" + before + "->" + after + (after < before ? " OK" : " 未生效"));
        step2();
      }, 400);
    };

    // 步骤 2：删表格（表格整体移除）
    const step2 = () => {
      putCursor(2, 1);
      const ok = runTableCmd("delTable");
      setTimeout(() => {
        const gone = !blockEl();
        results.push("delTable=" + String(ok) + " removed=" + String(gone) + (gone ? " OK" : " 未生效"));
        finish();
      }, 400);
    };

    step1();
  }, 2600);
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
