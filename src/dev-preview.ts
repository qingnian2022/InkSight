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
import { openTemplatePicker } from "./ui/templatePicker";
import { openImageLightbox } from "./ui/imageLightbox";
import { getPmCtx } from "./editor/pmCtxRef";
import { insertAtBoundary, runTableCmd } from "./editor/tableCmds";
import type { SyncStatus } from "./api";
import { editorViewCtx } from "@milkdown/core";
import { NodeSelection, TextSelection } from "@milkdown/prose/state";
// 直接拿 ProseMirror 视图实例做编程式选区（绕开 headless 无法真实点击的限制）

import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/skin-macos.css";

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
// ?skin=macos|default —— 切换界面皮肤（写 localStorage 走正式链路）
if (q.get("skin") === "macos" || q.get("skin") === "default") {
  const skin = q.get("skin") as "macos" | "default";
  localStorage.setItem("md-rust.skin", skin);
  document.documentElement.dataset.skin = skin;
  state.skin = skin;
}

// ?ctx=1 —— 打开文件右键菜单（目检「存为模板」）
if (q.get("ctx") === "1") {
  setTimeout(() => {
    const rows = [...document.querySelectorAll<HTMLElement>(".tree-row")];
    const row = rows.find((r) => r.dataset.path && !r.classList.contains("dir"));
    row?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 210, clientY: 300 }),
    );
  }, 1500);
}

// ?wp=1 —— 展开列宽菜单（目检 fixed 定位）
if (q.get("wp") === "1") {
  setTimeout(() => {
    (document.querySelector<HTMLElement>(".wp-btn") ?? null)?.click();
  }, 1600);
}

// ?ovf=1 —— 把富文本工具栏压窄并展开 ⋯ 溢出菜单（目检）
if (q.get("ovf") === "1") {
  setTimeout(() => {
    const inner = document.querySelector<HTMLElement>(".top-bar-inner");
    const bar = inner?.parentElement as HTMLElement | null;
    if (bar) bar.style.width = "420px";
    setTimeout(() => (document.querySelector<HTMLElement>(".toolbar-more") ?? null)?.click(), 300);
  }, 1600);
}

// ?tpl=1 —— 打开模板选择器；?lightbox=1 —— 打开图片灯箱
if (q.get("tpl") === "1") {
  setTimeout(() => {
    void openTemplatePicker(state.root);
  }, 600);
}
if (q.get("lightbox") === "1") {
  setTimeout(() => {
    openImageLightbox(
      "data:image/svg+xml;utf8," +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" rx="12" fill="#e8e8ec"/><text x="320" y="190" text-anchor="middle" font-size="22" fill="#86868b">示例图片</text></svg>`,
        ),
      "示例图注（读取 alt 文本）",
    );
  }, 600);
}

// ?accent=%230f5a8a —— 临时换主色，用于候选配色对比；不落盘
const accent = q.get("accent");
if (accent) document.documentElement.style.setProperty("--accent", decodeURIComponent(accent));
// ?at=purple|blue|pink —— 主题色（正式 token 体系），?acmenu=1 打开选择器弹层
const at = q.get("at");
if (at === "purple" || at === "blue" || at === "pink") {
  // 同时写 localStorage，App 的 init() 会按正式链路再应用一次
  localStorage.setItem("md-rust.accent", at);
  document.documentElement.dataset.accent = at;
  state.accent = at;
}
if (q.get("acmenu") === "1") {
  setTimeout(() => {
    document.querySelector<HTMLElement>(".accent-picker .tool-btn")?.click();
  }, 1600);
}
// ?hr=1 —— 在正文插一条 <hr>，用于目检 Markdown 分隔线样式
if (q.get("hr") === "1") {
  setTimeout(() => {
    const pm = document.querySelector<HTMLElement>(".ProseMirror");
    if (!pm) return;
    const title = pm.querySelector("h2");
    const hr = document.createElement("hr");
    title?.after(hr);
  }, 2600);
}

// ?whitescan=1 —— 暗色下扫描仍为纯白底的元素，定位漏映射的容器
if (q.get("whitescan") === "1") {
  setTimeout(() => {
    const hits: string[] = [];
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg === "rgb(255, 255, 255)" && el.clientWidth > 0 && el.clientHeight > 0) {
        const id = el.className && typeof el.className === "string"
          ? el.tagName.toLowerCase() + "." + el.className.split(/\s+/).slice(0, 2).join(".")
          : el.tagName.toLowerCase();
        if (!hits.includes(id)) hits.push(id);
      }
    });
    document.title = "WHITE(" + hits.length + "): " + hits.slice(0, 14).join(" ; ");
  }, 2600);
}
if (q.get("cssprobe") === "1") {
  setTimeout(() => {
    const cs = getComputedStyle(document.documentElement);
    const get = (k: string) => cs.getPropertyValue(k).trim();
    const bg = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel);
      return el ? getComputedStyle(el).backgroundColor : "none";
    };
    const div = document.querySelector<HTMLElement>(".md-tb-divider");
    const divCss = div ? getComputedStyle(div) : null;
    document.title = [
      "theme=" + document.documentElement.dataset.theme,
      "accent=" + document.documentElement.dataset.accent,
      "accentVar=" + get("--accent"),
      "surface=" + get("--surface"),
      "canvas=" + get("--canvas"),
      "text=" + get("--text-primary"),
      "titlebar=" + get("--titlebar-bg"),
      "| el.sidebar=" + bg(".sidebar"),
      "el.main=" + bg(".main"),
      "el.pm=" + bg(".ProseMirror"),
      "el.titlebar=" + bg(".titlebar"),
      "el.statusbar=" + bg(".statusbar"),
      "dividerH=" + (divCss?.height ?? "none"),
      "dividerBg=" + (divCss?.backgroundImage ?? "none").slice(0, 120),
    ].join(" ");
  }, 2500);
}

const doc = `# 写作工作台

把碎片记下来，再慢慢长出结构。这个知识库就是一个普通文件夹，没有数据库，也没有锁定格式。

## 今天的想法

- **先写，再整理**：不要在写第一段的时候就想目录
- 引用要能追溯来源，链接比摘要更可靠

## 加粗兼容回归（dev-preview）

**标题。**后面紧跟正文，这是中文标点闭合的失败形态。

**为什么不推荐 **这种星号内侧带空格的写法也要能加粗。

＊＊全角星号＊＊来自导出工具，也应显示为加粗。

**<font style="color:rgb(16, 188, 97);">彩色前半</font>****<font style="color:rgb(16, 188, 97);">彩色后半</font>**这是被彩色标签切开的加粗。

**卸载（unmount）\`Continuation\`**回来继续执行，跨行内代码也要加粗。

**<font style="color:rgb(16, 188, 97);">这个角色就是 Orchestrator（编排</font>****<font style="color:rgb(16, 188, 97);">）。</font>**

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

// ?quotedoc=1 —— 含 `> > 嵌套引用` 的文档，验证打开即拍平
if (q.get("quotedoc") === "1") {
  const md = ["# 引用用例", "", "> 外层引用", ">", "> > 内层引用", "> > 内层第二行", "", "收尾段落。", ""].join("\n");
  state.tabs = [
    { path: "D:/Notes/知识库/写作/quote.md", name: "quote", content: md, dirty: false },
  ];
  state.activePath = "D:/Notes/知识库/写作/quote.md";
}

// ?colordoc=1 —— 含嵌套 <font> 的历史文档，验证是否被拍平
if (q.get("colordoc") === "1") {
  const md = [
    "# 颜色用例",
    "",
    '<font style="color:#262626"><font style="color:#262626"><font style="color:#ffc21c">测试后无问题。</font></font></font>',
    "",
    "普通段落收尾。",
    "",
  ].join("\n");
  state.tabs = [
    { path: "D:/Notes/知识库/写作/color.md", name: "color", content: md, dirty: false },
  ];
  state.activePath = "D:/Notes/知识库/写作/color.md";
}

// ?outlinedoc=1 —— 多标题长文，用来测大纲跳转落点
if (q.get("outlinedoc") === "1") {
  const parts: string[] = [];
  for (let i = 1; i <= 6; i += 1) {
    parts.push(`## 章节 ${i}`, "");
    for (let j = 1; j <= 8; j += 1) parts.push(`第 ${i}-${j} 段正文，用来撑高内容，验证大纲跳转的落点。`, "");
  }
  parts.push("## 末尾章节", "", "最后一段。", "");
  state.tabs = [
    { path: "D:/Notes/知识库/写作/outline.md", name: "outline", content: parts.join("\n"), dirty: false },
  ];
  state.activePath = "D:/Notes/知识库/写作/outline.md";
}

// ?callout=1 —— 用提示块样张替换当前文档（目检 > [!TIP] 渲染）
if (q.get("callout") === "1") {
  const md = [
    "# 提示块样张",
    "",
    "> [!TIP] 发布前检查",
    "> 确认 version 已改、tag 已推。",
    "",
    "> [!WARNING]",
    "",
    "> [!NOTE] 说明",
    "> 普通说明块，带一行正文。",
    "",
    "> /[!NOTE] 斜杠残留也能识别",
    "> 这一行测试斜杠菜单残留字符。",
    "",
    "> 11[!NOTE]",
    "",
    "> 普通引用，不带标记。",
    "",
    "> [!FOLD] 附属资料",
    "> 这里是被折叠的内容，点右侧箭头收起。",
    "",
    "1. 第一项",
    "2. 第二项",
    "3. 第三项",
    "",
    "1. 项1",
    "2. 项2",
    "3. 项3",
    "4. 项4",
    "5. 项5",
    "6. 项6",
    "7. 项7",
    "8. 项8",
    "9. 项9",
    "10. 项10",
    "11. 项11",
    "12. 项12",
    "",
    "## 中段标题",
    "",
    "中间一段正文，用来把后面的标题推远，方便验证大纲跳转落点。",
    "",
    "## 可折叠的标题",
    "",
    "这一段应该被折叠起来。",
    "",
  ].join("\n");
  state.tabs = [
    { path: "D:/Notes/知识库/写作/callout.md", name: "callout", content: md, dirty: false },
  ];
  state.activePath = "D:/Notes/知识库/写作/callout.md";
}

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
        }, 1600);
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

// ?sync=ok|dirty|conflict|error|unset —— 同步面板状态演示（浏览器预览 mock）
const syncState = q.get("sync");
if (syncState) {
  const base: SyncStatus = {
    installed: true,
    initialized: true,
    hasRemote: true,
    remote: "https://gitee.com/hao-zhangjian/notes.git",
    branch: "main",
    dirty: false,
    ahead: 0,
    behind: 0,
    conflicted: false,
  };
  if (syncState === "dirty") {
    base.dirty = true;
    base.ahead = 1;
  } else if (syncState === "conflict") {
    base.conflicted = true;
  } else if (syncState === "unset") {
    base.initialized = false;
    base.hasRemote = false;
    base.remote = "";
  }
  state.syncStatus = base;
  if (syncState === "error") {
    state.syncError = true;
    state.syncMessage = "推送失败：远程仓库拒绝访问，请检查地址与登录状态";
  } else if (syncState === "conflict") {
    state.syncMessage = "同步冲突：两台机器改动了同一篇文档";
  } else if (syncState === "ok") {
    state.syncAt = Date.now() - 40_000;
    state.syncMessage = "已同步：提交 1 个文件并推送";
  } else if (syncState === "dirty") {
    state.syncAt = Date.now() - 3_600_000;
  }
  setTimeout(() => {
    const pill = document.querySelector<HTMLElement>(".sync-pill");
    pill?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    pill?.click();
  }, 1500);
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

/* ---------- 表格自检钩子（仅 dev-preview，不影响应用） ---------- */

/** ?tbl=1：光标进表格 → 工具条出现 → 点「中」→ 单元格居中 + markdown 写出对齐标记 */
if (q.get("tbl") === "1") {
  setTimeout(async () => {
    const { serializerCtx } = await import("@milkdown/core");
    const { TextSelection } = await import("@milkdown/prose/state");
    const ctx = getPmCtx() as any;
    if (!ctx) {
      document.title = "TBL NO_CTX";
      return;
    }
    const view = ctx.get(editorViewCtx) as any;
    let tablePos = -1;
    view.state.doc.descendants((n: any, pos: number) => {
      if (n.type.name === "table" && tablePos < 0) {
        tablePos = pos;
        return false;
      }
      return true;
    });
    if (tablePos < 0) {
      document.title = "TBL NO_TABLE";
      return;
    }
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(tablePos + 4))));
    view.focus();
    await new Promise((r) => setTimeout(r, 200));
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((r) => setTimeout(r, 600));

    const toolbar = document.querySelector(".tbl-toolbar");
    const centerBtn = Array.from(document.querySelectorAll(".tbl-btn")).find(
      (b) => (b.textContent || "").trim() === "中",
    ) as HTMLElement | undefined;
    centerBtn?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    centerBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 400));

    const readStyled = () => {
      const cell = document.querySelector(".milkdown-table-block table th, .milkdown-table-block table td") as HTMLElement | null;
      return !!cell && (cell.getAttribute("style") || "").indexOf("center") >= 0;
    };
    const clickStyled = readStyled();
    const tc = await import("./editor/tableCmds");
    const directOk = tc.setTableAlign("center");
    await new Promise((r) => setTimeout(r, 300));
    const styled = readStyled();
    const ser = ctx.get(serializerCtx) as any;
    const md: string = ser(view.state.doc);
    const mdOk = /:\s*-{2,}\s*:/.test(md);
    document.title = `TBL ${toolbar && centerBtn && styled && mdOk ? "PASS" : "FAIL"} click=${clickStyled} direct=${directOk} styled=${styled} md=${mdOk}`;
  }, 2600);
}

/** ?tbldel=1：数据行可一路删到只剩表头；再删无效；表头表仍可序列化/回读 */
if (q.get("tbldel") === "1") {
  setTimeout(async () => {
    const { TextSelection } = await import("@milkdown/prose/state");
    const { serializerCtx } = await import("@milkdown/core");
    const ctx = getPmCtx() as any;
    if (!ctx) {
      document.title = "TBDEL NO_CTX";
      return;
    }
    const view = ctx.get(editorViewCtx) as any;
    const tcmd = await import("./editor/tableCmds");

    const findTable = () => {
      let pos = -1;
      let node: any = null;
      view.state.doc.descendants((n: any, p: number) => {
        if (n.type.name === "table" && pos < 0) {
          pos = p;
          node = n;
          return false;
        }
        return true;
      });
      return { pos, node };
    };
    const caretRow = (rowIndex: number) => {
      const { pos, node } = findTable();
      let rowStart = -1;
      let rowNode: any = null;
      node.forEach((r: any, at: number, index: number) => {
        if (index === rowIndex) {
          rowStart = pos + 1 + at;
          rowNode = r;
        }
      });
      if (!rowNode) return false;
      let target = -1;
      rowNode.descendants((child: any, cp: number) => {
        if (target < 0 && child.isTextblock) target = rowStart + 1 + cp + 1;
        return target < 0;
      });
      if (target < 0) return false;
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(target), 1)));
      return true;
    };

    const first = findTable();
    if (!first.node) {
      document.title = "TBDEL NO_TABLE";
      return;
    }
    const startRows = first.node.childCount;

    // 反复删最后一行，直到只剩表头（childCount === 1）
    let steps = 0;
    for (let i = 0; i < 8; i += 1) {
      const { node } = findTable();
      if (!node || node.childCount <= 1) break;
      caretRow(node.childCount - 1);
      if (tcmd.runTableCmd("delRow")) steps += 1;
      await new Promise((r) => setTimeout(r, 90));
    }
    const headerOnly = findTable();
    const headerRows = headerOnly.node ? headerOnly.node.childCount : -1;

    // 再删一次：只剩表头时应无效，表格仍在
    caretRow(0);
    const extra = tcmd.runTableCmd("delRow");
    await new Promise((r) => setTimeout(r, 120));
    const finalTable = findTable();
    const finalRows = finalTable.node ? finalTable.node.childCount : -1;

    const ser = ctx.get(serializerCtx) as any;
    const md: string = ser(view.state.doc);
    const tableLines = md.split("\n").filter((l) => l.trim().startsWith("|")).length;

    const pass = headerRows === 1 && finalRows === 1 && tableLines === 2;
    document.title = `TBDEL ${pass ? "PASS" : "FAIL"} start=${startRows} steps=${steps} rows=${headerRows} final=${finalRows} mdLines=${tableLines} extra=${extra}`;
  }, 2800);
}

// ?probe=1 —— 把第一个提示块的 computed 样式写进 title，便于 headless 排查
if (q.get("probe") === "1") {
  setTimeout(() => {
    const el = document.querySelector(".milkdown blockquote:not(.md-callout):not(.md-foldblock)") as HTMLElement | null;
    if (!el) {
      document.title = "PROBE no-callout";
      return;
    }
    const list = [...document.querySelectorAll(".milkdown blockquote")].map((b) => {
      const cs2 = getComputedStyle(b as HTMLElement);
      return `${(b as HTMLElement).className || "quote"}:${cs2.borderLeftColor}`;
    });
    document.title = `BLOCKS ${list.join(" | ")}`;
    if (list.length) return;
    const cs = getComputedStyle(el);
    document.title = `PROBE bg=${cs.backgroundColor} border=${cs.borderLeftColor} width=${cs.borderLeftWidth} calloutVar=${cs.getPropertyValue("--callout")} cls=${el.className}`;
  }, 3500);
}

// ?caltest=1 —— 验证插入提示块后光标位置：插入标记后立刻“打字”，看文字在标记前还是后
if (q.get("caltest") === "1") {
  setTimeout(async () => {
    const { TextSelection } = await import("@milkdown/prose/state");
    const ctx = getPmCtx() as any;
    const view = ctx?.get(editorViewCtx) as any;
    if (!view) {
      document.title = "CALTEST no-view";
      return;
    }
    const { insertCallout } = await import("./editor/callouts");
    const end = view.state.doc.content.size;
    view.dispatch(
      view.state.tr.insert(end, view.state.schema.nodes.paragraph.create()),
    );
    view.dispatch(
      view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(view.state.doc.content.size - 1))),
    );
    insertCallout(view, "note");
    view.dispatch(view.state.tr.insertText("11"));
    const all: string[] = [];
    view.state.doc.descendants((n: any) => {
      if (n.type.name === "blockquote") all.push(n.textContent);
      return true;
    });
    document.title = `CALTEST last="${all[all.length - 1] ?? "none"}" n=${all.length}`;
  }, 3000);
}

// ?foldtest=1 —— 点折叠块的箭头，验证正文是否真的被隐藏
if (q.get("foldtest") === "1") {
  setTimeout(() => {
    const block = document.querySelector(".md-foldblock") as HTMLElement | null;
    const btn = block?.querySelector(".md-fold-chevron") as HTMLElement | null;
    if (!block || !btn) {
      document.title = "FOLDTEST no-block";
      return;
    }
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    setTimeout(() => {
      const after = document.querySelector(".md-foldblock") as HTMLElement | null;
      const paras = after ? [...after.querySelectorAll(":scope > p")] : [];
      const body = paras[1] as HTMLElement | undefined;
      const hidden = body ? getComputedStyle(body).display === "none" : null;
      document.title = `FOLDTEST folded=${after?.dataset.folded} bodyHidden=${hidden} p=${paras.length}`;
    }, 300);
  }, 3200);
}

// ?hit=1 —— 报出坐标 (355,620) 命中的元素与祖先，用于定位那条蓝色竖条
if (q.get("hit") === "1") {
  setTimeout(() => {
    const el = document.elementFromPoint(355, 620) as HTMLElement | null;
    const info: string[] = [];
    let cur = el;
    for (let i = 0; i < 4 && cur; i += 1) {
      const cs = getComputedStyle(cur);
      info.push(`${cur.tagName.toLowerCase()}.${cur.className}:border=${cs.borderLeftColor}/${cs.borderLeftWidth},bg=${cs.backgroundColor}`);
      cur = cur.parentElement;
    }
    document.title = `HIT ${info.join(" >> ")}`;
  }, 3200);
}

// ?qinfo=1 —— 普通引用的位置/边框颜色，以及该点命中的元素
if (q.get("qinfo") === "1") {
  setTimeout(() => {
    const bq = document.querySelector(".milkdown blockquote:not(.md-callout):not(.md-foldblock)") as HTMLElement | null;
    if (!bq) {
      document.title = "QINFO none";
      return;
    }
    const r = bq.getBoundingClientRect();
    const cs = getComputedStyle(bq);
    const hit = document.elementFromPoint(r.left + 2, r.top + r.height / 2) as HTMLElement | null;
    const hcs = hit ? getComputedStyle(hit) : null;
    document.title = `QINFO rect=${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)} border=${cs.borderLeftColor}/${cs.borderLeftWidth} hit=${hit?.tagName}.${hit?.className} hitBorder=${hcs?.borderLeftColor}/${hcs?.borderLeftWidth}`;
  }, 3200);
}

// ?pseudo=1 —— 看提示块 ::before/::after 是否画了额外的蓝色竖条
if (q.get("pseudo") === "1") {
  setTimeout(() => {
    const el = document.querySelector(".md-callout") as HTMLElement | null;
    if (!el) {
      document.title = "PSEUDO none";
      return;
    }
    const b = getComputedStyle(el, "::before");
    const a = getComputedStyle(el, "::after");
    document.title = `PSEUDO before{content=${b.content},bg=${b.backgroundColor},bw=${b.borderLeftWidth} ${b.borderLeftColor},w=${b.width},pos=${b.position}} after{content=${a.content},bg=${a.backgroundColor}}`;
  }, 3200);
}

// ?deltest=1 —— 插入空提示块后按一次 Backspace，验证整块（含标记）是否被删
if (q.get("deltest") === "1") {
  setTimeout(async () => {
    const { TextSelection } = await import("@milkdown/prose/state");
    const ctx = getPmCtx() as any;
    const view = ctx?.get(editorViewCtx) as any;
    if (!view) { document.title = "DELTEST no-view"; return; }
    const { insertCallout } = await import("./editor/callouts");
    const bqCount = () => { let n = 0; view.state.doc.descendants((x: any) => { if (x.type.name === "blockquote") n += 1; return true; }); return n; };
    const noteCount = () => (view.state.doc.textContent.match(/\[!NOTE\]/g) ?? []).length;

    view.dispatch(view.state.tr.insert(view.state.doc.content.size, view.state.schema.nodes.paragraph.create()));
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(view.state.doc.content.size - 1))));
    insertCallout(view, "note");
    await new Promise((r) => setTimeout(r, 150));
    const before = bqCount();
    view.focus();
    view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 250));
    document.title = `DELTEST bq=${before}->${bqCount()} note=${noteCount()}`;
  }, 3200);
}


// ?listtest=1 —— 排查列表：普通段落转列表 / 再点一次 / 互相转换 / 有序编号
if (q.get("listtest") === "1") {
  setTimeout(async () => {
    const { TextSelection } = await import("@milkdown/prose/state");
    const { commandsCtx } = await import("@milkdown/kit/core");
    const { wrapInBulletListCommand, wrapInOrderedListCommand, turnIntoTextCommand } = await import(
      "@milkdown/kit/preset/commonmark"
    );
    const ctx = getPmCtx() as any;
    const view = ctx?.get(editorViewCtx) as any;
    if (!view) { document.title = "LISTTEST no-view"; return; }

    const chain = () => {
      const $f = view.state.selection.$from;
      const out: string[] = [];
      for (let d = 1; d <= $f.depth; d += 1) {
        const n = $f.node(d);
        out.push(`${n.type.name}${n.attrs?.listType ? "/" + n.attrs.listType : ""}${n.attrs?.label ? "(" + n.attrs.label + ")" : ""}`);
      }
      return out.join(">");
    };
    const labelsIn = () => {
      const $f = view.state.selection.$from;
      for (let d = $f.depth; d > 0; d -= 1) {
        const n = $f.node(d);
        if (n.type.name !== "bullet_list" && n.type.name !== "ordered_list") continue;
        const ls: string[] = [];
        n.forEach((li: any) => ls.push(`${li.attrs.listType ?? "-"}${li.attrs.label ?? ""}`));
        return ls.join("|");
      }
      return "-";
    };

    // 取最后一个普通段落（样张末尾「这一段应该被折叠起来。」）
    let paraPos = -1;
    view.state.doc.descendants((n: any, pos: number) => {
      if (n.type.name === "paragraph" && n.textContent.includes("折叠")) paraPos = pos + 1;
      return true;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, paraPos)));

    const cmds = ctx.get(commandsCtx);
    const steps: string[] = [];
    cmds.call(wrapInOrderedListCommand.key);
    await new Promise((r) => setTimeout(r, 80));
    steps.push(`ordered1[${chain()}] items=${labelsIn()}`);
    cmds.call(wrapInOrderedListCommand.key);
    await new Promise((r) => setTimeout(r, 80));
    steps.push(`ordered2[${chain()}]`);
    cmds.call(wrapInBulletListCommand.key);
    await new Promise((r) => setTimeout(r, 80));
    steps.push(`toBullet[${chain()}] items=${labelsIn()}`);
    cmds.call(turnIntoTextCommand.key);
    await new Promise((r) => setTimeout(r, 80));
    steps.push(`toText[${chain()}]`);

    document.title = `LISTTEST ${steps.join(" || ")}`;
  }, 3400);
}

// ?labeltest=1 —— 有序列表新增项后 label 是否按序重算（1./2./3.）
if (q.get("labeltest") === "1") {
  setTimeout(async () => {
    const { TextSelection } = await import("@milkdown/prose/state");
    const { commandsCtx } = await import("@milkdown/kit/core");
    const { wrapInOrderedListCommand, splitListItemCommand } = await import("@milkdown/kit/preset/commonmark");
    const ctx = getPmCtx() as any;
    const view = ctx?.get(editorViewCtx) as any;
    if (!view) { document.title = "LABELTEST no-view"; return; }
    let paraPos = -1;
    view.state.doc.descendants((n: any, pos: number) => {
      if (n.type.name === "paragraph" && n.textContent.includes("折叠")) paraPos = pos + 1;
      return true;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, paraPos)));
    const cmds = ctx.get(commandsCtx);
    cmds.call(wrapInOrderedListCommand.key);
    await new Promise((r) => setTimeout(r, 60));
    cmds.call(splitListItemCommand.key);
    await new Promise((r) => setTimeout(r, 60));
    cmds.call(splitListItemCommand.key);
    await new Promise((r) => setTimeout(r, 120));
    const labels: string[] = [];
    view.state.doc.descendants((n: any) => {
      if (n.type.name === "list_item" && n.attrs.listType === "ordered") labels.push(n.attrs.label);
      return true;
    });
    const dom = [...document.querySelectorAll(".milkdown-list-item-block li .label")].map((e) => e.textContent?.trim());
    document.title = `LABELTEST doc=[${labels.join(",")}] dom=[${dom.slice(-3).join(",")}]`;
  }, 3400);
}

// ?listfix=1 —— 验证新的列表切换：包成列表 / 再点取消 / 互相转换 / 编号
if (q.get("listfix") === "1") {
  setTimeout(async () => {
    const { TextSelection } = await import("@milkdown/prose/state");
    const { toggleList } = await import("./editor/list-commands");
    const ctx = getPmCtx() as any;
    const view = ctx?.get(editorViewCtx) as any;
    if (!view) { document.title = "LISTFIX no-view"; return; }

    const chain = () => {
      const $f = view.state.selection.$from;
      const out: string[] = [];
      for (let d = 1; d <= $f.depth; d += 1) {
        const n = $f.node(d);
        out.push(`${n.type.name}${n.attrs?.listType ? "/" + n.attrs.listType : ""}${n.attrs?.label ? "(" + n.attrs.label + ")" : ""}`);
      }
      return out.join(">");
    };
    const labelsIn = () => {
      const $f = view.state.selection.$from;
      for (let d = $f.depth; d > 0; d -= 1) {
        const n = $f.node(d);
        if (n.type.name !== "bullet_list" && n.type.name !== "ordered_list") continue;
        const ls: string[] = [];
        n.forEach((li: any) => ls.push(`${li.attrs.label}`));
        return ls.join("|");
      }
      return "-";
    };
    const findPara = () => {
      let p = -1;
      view.state.doc.descendants((n: any, pos: number) => {
        if (n.type.name === "paragraph" && n.textContent.includes("折叠")) p = pos + 1;
        return true;
      });
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, p)));
    };

    const steps: string[] = [];
    findPara();
    toggleList(ctx, "ordered");
    await new Promise((r) => setTimeout(r, 80));
    steps.push(`ordered[${chain()}]`);
    toggleList(ctx, "ordered");
    await new Promise((r) => setTimeout(r, 80));
    steps.push(`again[${chain()}]`);
    toggleList(ctx, "bullet");
    await new Promise((r) => setTimeout(r, 80));
    steps.push(`bullet[${chain()}]`);
    toggleList(ctx, "ordered");
    await new Promise((r) => setTimeout(r, 80));
    steps.push(`toOrdered[${chain()}] labels=${labelsIn()}`);
    // 多项目列表转换：样张里的 3 项列表
    let itemPos = -1;
    view.state.doc.descendants((n: any, pos: number) => {
      if (itemPos < 0 && n.type.name === "paragraph" && n.textContent.includes("第一项")) itemPos = pos + 1;
      return true;
    });
    if (itemPos > 0) {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, itemPos)));
      toggleList(ctx, "bullet");
      await new Promise((r) => setTimeout(r, 80));
      steps.push(`multiToBullet[${chain()}]`);
      toggleList(ctx, "ordered");
      await new Promise((r) => setTimeout(r, 80));
      steps.push(`multiToOrdered labels=${labelsIn()}`);
    }

    // 取消整个有序列表：内容应变成普通段落且不丢项
    const textBefore = view.state.doc.textContent;
    toggleList(ctx, "ordered");
    await new Promise((r) => setTimeout(r, 120));
    let paras = 0;
    view.state.doc.descendants((n: any) => {
      if (n.type.name === "paragraph" && /项\d|第一项/.test(n.textContent)) paras += 1;
      return true;
    });
    const textAfter = view.state.doc.textContent;
    steps.push(`cancelList[${chain()}] same=${textBefore === textAfter} len=${textBefore.length}->${textAfter.length}`);

    document.title = `LISTFIX ${steps.join(" || ")}`;
  }, 3400);
}

// ?topbar=1 —— 工具栏列表按钮：列出 aria-label，并点击「有序列表」验证是否走新命令
if (q.get("topbar") === "1") {
  setTimeout(async () => {
    const { TextSelection } = await import("@milkdown/prose/state");
    const ctx = getPmCtx() as any;
    const view = ctx?.get(editorViewCtx) as any;
    if (!view) { document.title = "TOPBAR no-view"; return; }
    const items = [...document.querySelectorAll<HTMLElement>(".top-bar-item")].map(
      (el) => el.getAttribute("aria-label") || el.getAttribute("title") || el.dataset.key || "?",
    );
    const btn = [...document.querySelectorAll<HTMLElement>(".top-bar-item")].find(
      (el) => (el.getAttribute("aria-label") || "").includes("有序"),
    );
    let paraPos = -1;
    view.state.doc.descendants((n: any, pos: number) => {
      if (n.type.name === "paragraph" && n.textContent.includes("折叠")) paraPos = pos + 1;
      return true;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, paraPos)));
    btn?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const $f = view.state.selection.$from;
    const tops: string[] = [];
    for (let d = 1; d <= $f.depth; d += 1) tops.push($f.node(d).type.name);
    document.title = `TOPBAR items=[${items.join(",")}] btn=${!!btn} chain=${tops.join(">")}`;
  }, 3400);
}

// ?topbar2=1 —— 工具栏：点无序两次（第二次取消）→ 点有序（转换）→ 再点（取消）
if (q.get("topbar2") === "1") {
  setTimeout(async () => {
    const { TextSelection } = await import("@milkdown/prose/state");
    const ctx = getPmCtx() as any;
    const view = ctx?.get(editorViewCtx) as any;
    if (!view) { document.title = "TOPBAR2 no-view"; return; }

    const chain = () => {
      const $f = view.state.selection.$from;
      const out: string[] = [];
      for (let d = 1; d <= $f.depth; d += 1) {
        const n = $f.node(d);
        out.push(n.type.name + (n.attrs?.listType ? "/" + n.attrs.listType : ""));
      }
      return out.join(">");
    };
    const btnAt = (lo: number, hi: number) =>
      [...document.querySelectorAll<HTMLElement>(".top-bar-item")].find((el) => {
        const r = el.getBoundingClientRect();
        return r.left > lo && r.left < hi && r.top < 200;
      }) ?? null;
    const fire = (el: HTMLElement | null) =>
      el?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));

    let paraPos = -1;
    view.state.doc.descendants((n: any, pos: number) => {
      if (n.type.name === "paragraph" && n.textContent.includes("折叠")) paraPos = pos + 1;
      return true;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, paraPos)));

    const bulletBtn = btnAt(488, 504);
    const orderedBtn = btnAt(522, 540);
    const out: string[] = [];

    fire(bulletBtn);
    await new Promise((r) => setTimeout(r, 180));
    out.push(`bullet1=${chain()}`);
    fire(bulletBtn);
    await new Promise((r) => setTimeout(r, 180));
    out.push(`bullet2=${chain()}`);
    fire(orderedBtn);
    await new Promise((r) => setTimeout(r, 180));
    out.push(`ordered1=${chain()}`);
    fire(orderedBtn);
    await new Promise((r) => setTimeout(r, 180));
    out.push(`ordered2=${chain()}`);

    document.title = `TOPBAR2 ${out.join(" ")}`;
  }, 3400);
}

// ?divtest=1 —— 工具栏分隔线是否存在、尺寸与颜色
if (q.get("divtest") === "1") {
  setTimeout(() => {
    const els = [...document.querySelectorAll<HTMLElement>(".milkdown-top-bar .top-bar-divider")];
    const info = els.map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return `${Math.round(r.width)}x${Math.round(r.height)} bg=${cs.backgroundColor} disp=${cs.display}`;
    });
    const bar = document.querySelector(".milkdown-top-bar") as HTMLElement | null;
    const barCs = bar ? getComputedStyle(bar) : null;
    document.title = `DIVTEST n=${els.length} [${info.join(" | ")}] barH=${bar ? Math.round(bar.getBoundingClientRect().height) : "-"} border=${barCs?.borderBottomColor}`;
  }, 3200);
}

// ?splittest=1 —— 颜色分裂按钮：两个按钮是否贴合、圆角是否只在外侧
if (q.get("splittest") === "1") {
  setTimeout(() => {
    const a = document.querySelector<HTMLElement>(".milkdown-top-bar .top-bar-item:has(.md-rust-color-glyph)");
    const b = document.querySelector<HTMLElement>(".milkdown-top-bar .top-bar-item:has(.md-rust-color-chevron)");
    if (!a || !b) { document.title = `SPLITTEST a=${!!a} b=${!!b}`; return; }
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const ca = getComputedStyle(a);
    const cb = getComputedStyle(b);
    document.title = `SPLITTEST A=${Math.round(ra.left)}w${Math.round(ra.width)}r=${ca.borderRadius} B=${Math.round(rb.left)}w${Math.round(rb.width)}r=${cb.borderRadius} gap=${Math.round(rb.left - ra.right)}`;
  }, 3200);
}

// ?tiptest=1 —— 工具栏功能提示：标签顺序 + hover 是否弹出
if (q.get("tiptest") === "1") {
  setTimeout(() => {
    const els = [...document.querySelectorAll<HTMLElement>(".milkdown-top-bar [data-tip]")];
    const tips = els.map((el) => el.dataset.tip);
    const target = els[3];
    target?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    setTimeout(() => {
      const tip = document.querySelector(".tb-tip");
      document.title = `TIPTEST n=${els.length} tips=[${tips.join(",")}] shown=${tip?.classList.contains("show")} text=${tip?.textContent}`;
    }, 400);
  }, 3200);
}

// ?outlinetest=1 —— 逐条点大纲，记录滚动位置与标题相对偏移（强制瞬时滚动便于测量）
if (q.get("outlinetest") === "1") {
  setTimeout(async () => {
    const scroller = document.querySelector(".milkdown") as HTMLElement | null;
    const items = [...document.querySelectorAll<HTMLElement>(".outline-item")];
    if (!scroller || !items.length) {
      document.title = `OUTLINETEST scroller=${!!scroller} items=${items.length}`;
      return;
    }
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {
      const opts = typeof arg === "object" && arg ? { ...arg, behavior: "auto" as ScrollBehavior } : arg;
      return orig.call(this, opts as ScrollIntoViewOptions);
    };

    const rows: string[] = [];
    for (const item of items) {
      item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 260));
      const text = item.textContent?.trim() ?? "";
      const h = [...document.querySelectorAll<HTMLElement>(".milkdown h1, .milkdown h2, .milkdown h3")].find(
        (el) => (el.textContent ?? "").trim() === text,
      );
      const top = h ? Math.round(h.getBoundingClientRect().top - scroller.getBoundingClientRect().top) : null;
      rows.push(`${text}@${Math.round(scroller.scrollTop)}/${top}`);
    }
    // 反向点一遍，验证向上跳转方向
    const back: string[] = [];
    for (const item of [...items].reverse()) {
      item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 220));
      const text = item.textContent?.trim() ?? "";
      const h = [...document.querySelectorAll<HTMLElement>(".milkdown h1, .milkdown h2, .milkdown h3")].find(
        (el) => (el.textContent ?? "").trim() === text,
      );
      const top = h ? Math.round(h.getBoundingClientRect().top - scroller.getBoundingClientRect().top) : null;
      back.push(`${text}@${Math.round(scroller.scrollTop)}/${top}`);
    }
    Element.prototype.scrollIntoView = orig;
    document.title = `OUTLINETEST fwd:${rows.join(" | ")} || back:${back.join(" | ")}`;
  }, 3600);
}

// ?bartest=1 —— 工具栏与滚动层的关系（位置/是否在滚动容器内）
if (q.get("bartest") === "1") {
  setTimeout(() => {
    const bar = document.querySelector(".milkdown-top-bar") as HTMLElement | null;
    const md = document.querySelector(".milkdown") as HTMLElement | null;
    if (!bar || !md) { document.title = `BARTEST bar=${!!bar} md=${!!md}`; return; }
    const cs = getComputedStyle(bar);
    const rb = bar.getBoundingClientRect();
    const rm = md.getBoundingClientRect();
    document.title = `BARTEST pos=${cs.position} z=${cs.zIndex} h=${Math.round(rb.height)} barTop=${Math.round(rb.top)} mdTop=${Math.round(rm.top)} inside=${md.contains(bar)} parent=${bar.parentElement?.className}`;
  }, 3200);
}

// ?colortest=1 —— 统计嵌套的彩色节点 / <font> 层数
if (q.get("colortest") === "1") {
  setTimeout(async () => {
    const ctx = getPmCtx() as any;
    const view = ctx?.get(editorViewCtx) as any;
    if (!view) { document.title = "COLORTEST no-view"; return; }
    let total = 0;
    let nested = 0;
    view.state.doc.descendants((node: any, _pos: number, parent: any) => {
      if (node.type.name !== "coloredText") return true;
      total += 1;
      if (parent && parent.type.name === "coloredText") nested += 1;
      return true;
    });
    const domNested = document.querySelectorAll('[data-colored-text] [data-colored-text]').length;
    document.title = `COLORTEST total=${total} nested=${nested} domNested=${domNested}`;
  }, 3400);
}

// ?nesttest=1 —— 程序化制造 nested coloredText / 双标记，验证自动拍平与互斥
if (q.get("nesttest") === "1") {
  setTimeout(async () => {
    const ctx = getPmCtx() as any;
    const view = ctx?.get(editorViewCtx) as any;
    if (!view) { document.title = "NESTTEST no-view"; return; }
    const schema = view.state.schema;
    const type = schema.nodes.coloredText;
    const text = schema.text("嵌套测试");

    // 1) 直接插入「外层灰 + 内层黄」
    const inner = type.create({ color: "#ffc21c" }, text);
    const outer = type.create({ color: "#262626" }, inner);
    let paraPos = -1;
    view.state.doc.descendants((n: any, pos: number) => {
      if (paraPos < 0 && n.type.name === "paragraph" && n.textContent.includes("普通段落收尾")) paraPos = pos + 1;
      return true;
    });
    view.dispatch(view.state.tr.insert(paraPos, outer));
    await new Promise((r) => setTimeout(r, 120));

    let nested = 0;
    let colors: string[] = [];
    view.state.doc.descendants((n: any, _p: number, parent: any) => {
      if (n.type.name !== "coloredText") return true;
      colors.push(n.attrs.color);
      if (parent && parent.type.name === "coloredText") nested += 1;
      return true;
    });

    // 2) 提示块里插折叠块：应替换标记而不是叠加
    const { insertCallout } = await import("./editor/callouts");
    const { insertFoldBlock } = await import("./editor/fold-block");
    let p2 = -1;
    view.state.doc.descendants((n: any, pos: number) => {
      if (p2 < 0 && n.type.name === "paragraph" && n.textContent.includes("普通段落收尾")) p2 = pos + 1;
      return true;
    });
    view.dispatch(view.state.tr.setSelection((await import("@milkdown/prose/state")).TextSelection.create(view.state.doc, p2)));
    insertCallout(view, "note");
    await new Promise((r) => setTimeout(r, 100));
    insertFoldBlock(view);
    await new Promise((r) => setTimeout(r, 120));

    let markerText = "";
    view.state.doc.descendants((n: any) => {
      if (!markerText && n.type.name === "blockquote") markerText = n.textContent.trim().slice(0, 40);
      return true;
    });
    const markers = (view.state.doc.textContent.match(/\[!(NOTE|TIP|FOLD)\]/g) ?? []).length;
    document.title = `NESTTEST nested=${nested} colors=${colors.join(",")} markers=${markers} text=${markerText}`;
  }, 3400);
}

// ?quotetest=1 —— 连续套两层引用，验证是否被拍平成一层
if (q.get("quotetest") === "1") {
  setTimeout(async () => {
    const { TextSelection } = await import("@milkdown/prose/state");
    const { wrapIn } = await import("@milkdown/kit/prose/commands");
    const ctx = getPmCtx() as any;
    const view = ctx?.get(editorViewCtx) as any;
    if (!view) { document.title = "QUOTETEST no-view"; return; }
    let p = -1;
    view.state.doc.descendants((n: any, pos: number) => {
      if (p < 0 && n.type.name === "paragraph" && n.textContent.includes("普通段落收尾")) p = pos + 1;
      return true;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, p)));
    const bq = view.state.schema.nodes.blockquote;
    wrapIn(bq)(view.state, (tr: any) => view.dispatch(tr));
    await new Promise((r) => setTimeout(r, 80));
    wrapIn(bq)(view.state, (tr: any) => view.dispatch(tr));
    await new Promise((r) => setTimeout(r, 150));

    let total = 0;
    let nested = 0;
    view.state.doc.descendants((n: any, _pos: number, parent: any) => {
      if (n.type.name !== "blockquote") return true;
      total += 1;
      if (parent && parent.type.name === "blockquote") nested += 1;
      return true;
    });
    document.title = `QUOTETEST total=${total} nested=${nested}`;
  }, 3400);
}

// ?quotecheck=1 —— 打开文档后统计引用嵌套
if (q.get("quotecheck") === "1") {
  setTimeout(() => {
    const ctx = getPmCtx() as any;
    const view = ctx?.get(editorViewCtx) as any;
    if (!view) { document.title = "QUOTECHECK no-view"; return; }
    let total = 0;
    let nested = 0;
    view.state.doc.descendants((n: any, _p: number, parent: any) => {
      if (n.type.name !== "blockquote") return true;
      total += 1;
      if (parent && parent.type.name === "blockquote") nested += 1;
      return true;
    });
    document.title = `QUOTECHECK total=${total} nested=${nested}`;
  }, 3200);
}
