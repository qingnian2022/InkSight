/**
 * 强调归一化规则（纯 mdast 变换，无框架依赖）。
 *
 * 为什么要做：CommonMark 对 `**` 何时能「闭合」有严格规则，中文写作里
 * 最常见的 `**标题。**正文`（闭合星号紧贴中文标点）会被判定为**不能闭合**，
 * 于是整段原样显示星号。实测知识库 225 篇里有 500+ 处这种写法。
 *
 * 策略：解析后仍然以纯文本形式留着成对 `**` 的，按下列规则还原：
 * 1. 同一文本节点内的成对 `**…**` → strong（内容 trim）
 * 2. 跨节点的成对 `**`（中间夹着行内代码/链接）→ 跨越收集成 strong
 * 3. 全角 ＊ 当半角 * 处理
 * 4. 未闭合的单个 `**` → 原样保留（不吞内容，避免误加粗后半段）
 * 5. `****`（空内容）→ 原样保留
 */

/**
 * 已在加粗/斜体内部：连续星号是导出工具的「缝合标记」（`**A****B**`），
 * 去掉即可——再当成开/关标记会吐出字面 `****`。
 * @param {any[]} children
 */
function stripGlue(children) {
  const out = [];
  for (const child of children) {
    if (child.type === "text" && typeof child.value === "string") {
      const value = child.value.replace(/\*{2,}/g, "");
      if (!value) continue;
      out.push(value === child.value ? child : { ...child, value });
      continue;
    }
    out.push(child);
  }
  return out;
}

/**
 * 递归整棵树：普通容器做强调还原，strong/emphasis 内部只清缝合星号。
 * @param {any} node
 */
export function fixInlineTree(node) {
  if (!Array.isArray(node.children)) return;
  if (node.type === "strong" || node.type === "emphasis") {
    node.children = stripGlue(node.children);
    node.children.forEach(fixInlineTree);
    return;
  }
  node.children = fixInlineChildren(node.children);
  node.children.forEach(fixInlineTree);
}

/**
 * @param {any[]} children
 * @returns {any[]}
 */
export function fixInlineChildren(children) {
  const out = [];
  /** @type {any[] | null} 正在收集的加粗内容 */
  let buffer = null;
  /** @type {any[] | null} <b> … </b> 收集区 */
  let bBuffer = null;

  const target = () => (bBuffer ?? buffer ?? out);

  const trimStrong = (nodes) => {
    const list = [...nodes];
    // 去掉首尾文本节点里的空白（** 加粗 ** 的常见形态）
    while (list.length && list[0].type === "text") {
      const v = String(list[0].value ?? "").replace(/^\s+/, "");
      if (v) {
        list[0] = { ...list[0], value: v };
        break;
      }
      list.shift();
    }
    while (list.length && list[list.length - 1].type === "text") {
      const v = String(list[list.length - 1].value ?? "").replace(/\s+$/, "");
      if (v) {
        list[list.length - 1] = { ...list[list.length - 1], value: v };
        break;
      }
      list.pop();
    }
    return list;
  };

  const flushStrong = () => {
    if (!buffer) return;
    const nodes = trimStrong(buffer);
    buffer = null;
    // 注意：<b> 收集期间关闭的 strong 要落进 bBuffer，不能直接进 out
    const sink = bBuffer ?? out;
    if (!nodes.length) {
      // 空加粗（****）：合成一个字面量节点，行为与原来一致
      sink.push({ type: "text", value: "****" });
      return;
    }
    sink.push({ type: "strong", children: nodes });
  };

  const pushText = (value) => {
    if (!value) return;
    target().push({ type: "text", value });
  };

  for (const child of children) {
    // ── <b> / <strong> 标签对 ──
    if (child.type === "html") {
      const value = String(child.value ?? "").trim();
      if (!bBuffer && /^<(b|strong)\b[^>]*>$/i.test(value)) {
        bBuffer = [];
        continue;
      }
      if (bBuffer && /^<\/(b|strong)\s*>$/i.test(value)) {
        const inner = fixInlineChildren(bBuffer);
        bBuffer = null;
        out.push({ type: "strong", children: inner });
        continue;
      }
    }

    let node = child;

    // ── 反引号整体包住的强调：`**加粗**` / `*斜体*` ──
    if (node.type === "inlineCode" && typeof node.value === "string") {
      const bold = /^\s*\*\*\s*([^*]+?)\s*\*\*\s*$/.exec(node.value);
      if (bold) {
        target().push({ type: "strong", children: [{ type: "text", value: bold[1] }] });
        continue;
      }
      const italic = /^\s*\*\s*([^*]+?)\s*\*\s*$/.exec(node.value);
      if (italic) {
        target().push({ type: "emphasis", children: [{ type: "text", value: italic[1] }] });
        continue;
      }
    }

    // ── 文本里的星号：按「连续 run」处理 ──
    // 关键：`**A****B**`（彩色标签把粗体切段）里的 `****` 必须理解成
    // 「关闭 A + 立刻重开 B」，而不是 关闭 + 空加粗（会漏出字面星号）。
    if (node.type === "text" && typeof node.value === "string") {
      const value = node.value.replace(/＊/g, "*");
      if (!value.includes("*")) {
        pushText(value);
        continue;
      }
      let idx = 0;
      while (idx < value.length) {
        const next = value.indexOf("*", idx);
        if (next === -1) {
          pushText(value.slice(idx));
          break;
        }
        let end = next;
        while (value[end] === "*") end += 1;
        const run = end - next;

        pushText(value.slice(idx, next));

        if (run >= 2) {
          // 每两个星号一次开/关切换；「关完再开」即同一段加粗的续段
          const pairs = Math.floor(run / 2);
          for (let p = 0; p < pairs; p += 1) {
            if (buffer) flushStrong();
            else buffer = [];
          }
        }
        if (run % 2 === 1) pushText("*"); // 落单的 * 原样保留
        idx = end;
      }
      continue;
    }

    target().push(node);
  }

  // 未闭合的 **：原样还原（不加粗后半段）
  if (buffer) {
    (bBuffer ?? out).push({ type: "text", value: "**" }, ...buffer);
    buffer = null;
  }
  // 未闭合的 <b>
  if (bBuffer) {
    out.push({ type: "html", value: "<b>" }, ...bBuffer);
    bBuffer = null;
  }

  return out;
}
