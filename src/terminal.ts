import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type IDecoration, type IMarker, type ITheme } from "@xterm/xterm";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { reactive, watch, nextTick } from "vue";
import { notify, state } from "./store";

/**
 * 终端会话与 xterm 实例的桥。
 *
 * 分工：
 * - Rust 侧持有 PTY 句柄（`terminal.rs`），只按 id 收发；
 * - 这里维护「前端看得见的那一半」：会话元数据是响应式的（侧栏 / 标签要渲染），
 *   xterm 实例放在普通 Map 里 —— 把 Terminal 塞进 reactive 会被深度代理，
 *   xterm 内部大量自引用，代理后性能和身份判断都会出问题。
 */

export interface TermSession {
  id: number;
  title: string;
  alive: boolean;
}

/** 回显的运行时状态：元素创建一次，之后只改文字与位移，避免每敲一个字都重建导致闪烁 */
interface Ghost {
  marker: IMarker;
  deco: IDecoration;
  el: HTMLElement | null;
  /** 创建时所在列。元素从此不再移动，靠左侧裁剪模拟「被自己敲掉」的部分 */
  baseX: number;
  /** 当前光标列 */
  x: number;
  /** 命中的完整命令 */
  hit: string;
  /** 创建时渲染进 DOM 的剩余文本，之后不再改写 */
  full: string;
  /** 创建时的输入行长度，用来算要裁掉多少个字符 */
  lineLen: number;
  /** 已经应用的裁剪像素，避免重复写样式 */
  appliedClip: number;
  cellWidth: number;
}

interface Instance {
  id: number;
  term: Terminal;
  fit: FitAddon;
  ro: ResizeObserver;
  /** 当前输入行的镜像。只用于算回显，不参与任何写回 */
  line: string;
  /** 镜像是否可信：出现方向键 / Tab / 未知控制符后置 false，回车或清行后恢复 */
  tracked: boolean;
  /** 正在显示的回显（xterm 装饰器，纯视觉，不进缓冲区） */
  ghost: Ghost | null;
  /** 待执行的定位任务句柄：输出还在刷时先攒着，别把中间态画出来 */
  ghostTimer: number;
}

const LS_HEIGHT = "md-rust.term-height";
const MIN_HEIGHT = 120;

export const termStore = reactive({
  open: false,
  sessions: [] as TermSession[],
  activeId: 0,
  height: Number(localStorage.getItem(LS_HEIGHT)) || 240,
  error: "",
  /** 侧栏里正在内联重命名的会话 id；0 表示没有 */
  renamingId: 0,
});

const instances = new Map<number, Instance>();
let listening = false;
let seq = 0;
let nextId = 1;

/* ---------- 主题 ---------- */

function cssVar(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * 背景 / 前景 / 光标跟随界面主题（含明暗切换），ANSI 16 色用 tokens.css 里的固定语义色。
 * 这样换主色时 chrome 会跟着变，但语法着色保持稳定 —— 语法色属于语义，不是装饰。
 */
function terminalTheme(): ITheme {
  const dark = document.documentElement.dataset.theme === "dark";
  const surface = cssVar("--surface", dark ? "#151d1a" : "#ffffff");
  const text = cssVar("--text-primary", dark ? "#e7ece9" : "#1d2120");
  return {
    background: surface,
    foreground: text,
    cursor: cssVar("--accent", dark ? "#84cdbd" : "#4a5050"),
    cursorAccent: surface,
    selectionBackground: dark ? "rgba(132, 205, 189, 0.26)" : "rgba(74, 80, 80, 0.16)",
    // 16 色是固定的语义色（见 tokens.css），不从 --accent 派生：
    // 换主题色时语法着色不该跟着变，否则 cyan 会再次和正文撞色
    black: cssVar("--term-black", text),
    red: cssVar("--term-red", "#b0392c"),
    green: cssVar("--term-green", "#2f7a4a"),
    yellow: cssVar("--term-yellow", "#8a5a0f"),
    blue: cssVar("--term-blue", "#2f6396"),
    magenta: cssVar("--term-magenta", "#7c4470"),
    cyan: cssVar("--term-cyan", "#2c6f6a"),
    white: cssVar("--term-white", "#3a4140"),
    brightBlack: cssVar("--term-bright-black", "#6b7370"),
    brightRed: cssVar("--term-bright-red", "#c9503c"),
    brightGreen: cssVar("--term-bright-green", "#3d8f5b"),
    brightYellow: cssVar("--term-bright-yellow", "#a5711a"),
    brightBlue: cssVar("--term-bright-blue", "#3d7ab5"),
    brightMagenta: cssVar("--term-bright-magenta", "#99548a"),
    brightCyan: cssVar("--term-bright-cyan", "#388a83"),
    brightWhite: cssVar("--term-bright-white", text),
  };
}

function applyTheme() {
  const theme = terminalTheme();
  for (const inst of instances.values()) inst.term.options.theme = theme;
}

watch(
  () => [state.theme, state.accent, state.skin],
  () => applyTheme(),
  { flush: "post" },
);

/* ---------- 与后端对接 ---------- */

async function ensureListeners() {
  if (listening) return;
  listening = true;
  await listen<{ id: number; data: string }>("term://data", (event) => {
    const inst = instances.get(event.payload.id);
    if (!inst) return;
    // 每次写都立即重定位会被「回显 + 整行重绘」这两个分片拆开画，
    // 中间态（光标短暂回到行首/行中）就是抖动的来源。攒 32ms 再定位，只画稳定后的位置。
    inst.term.write(event.payload.data, () => scheduleGhost(inst));
  });
  await listen<{ id: number }>("term://exit", (event) => {
    const session = termStore.sessions.find((s) => s.id === event.payload.id);
    if (session) session.alive = false;
    instances
      .get(event.payload.id)
      ?.term.write("\r\n\x1b[90m[进程已退出]\x1b[0m\r\n");
  });
}

function pushSize(term: Terminal, id: number) {
  const { cols, rows } = term;
  if (cols > 0 && rows > 0) {
    void invoke("term_resize", { id, cols, rows }).catch(() => {});
  }
}

/** 把某个会话的 xterm 挂到宿主元素上（每个会话只挂一次）。 */
export function mountSession(id: number, host: HTMLElement) {
  if (instances.has(id)) return;

  const term = new Terminal({
    // 回显用的是 decoration API，它在 xterm 里属于 proposed API：
    // 不开这个开关，registerDecoration 会直接抛错（错误在 onData 回调里被吞掉，
    // 表现就是「什么都没发生」——排查过一次，别再删）
    allowProposedApi: true,
    fontFamily: cssVar("--font-mono", "Consolas, monospace"),
    fontSize: 13,
    lineHeight: 1.4,
    fontWeight: 400,
    fontWeightBold: 600,
    letterSpacing: 0,
    cursorBlink: true,
    cursorStyle: "bar",
    cursorInactiveStyle: "outline",
    drawBoldTextInBrightColors: true,
    // 低对比度的 ANSI 色（深蓝、暗红）压在浅色底上会糊，交给 xterm 抬到可读
    minimumContrastRatio: 3,
    scrollback: 5000,
    theme: terminalTheme(),
    // ConPTY 的重排语义与 Unix 不同，显式声明后 xterm 才能正确处理换行/回绕
    windowsPty: { backend: "conpty" },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);

  let raf = 0;
  let inst: Instance | null = null;
  const push = () => {
    if (inst) pushSize(inst.term, id);
  };
  const ro = new ResizeObserver(() => {
    // 收起时（display:none）量不到尺寸，别把 2×10 这种最小值写进 PTY
    if (host.offsetParent === null) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        // 容器还没尺寸，跳过即可
      }
      if (inst) clearGhost(inst); // 重排后单元格坐标变了，旧回显会错位
      push();
    });
  });
  ro.observe(host);

  inst = { id, term, fit, ro, line: "", tracked: true, ghost: null, ghostTimer: 0 };
  instances.set(id, inst);

  term.onData((data) => {
    void invoke("term_write", { id, data }).catch(() => {});
    if (inst) feed(inst, data);
  });

  // 失焦时收起回显，别在切走之后还留一段灰字
  term.textarea?.addEventListener("blur", () => {
    if (inst) clearGhost(inst);
  });

  requestAnimationFrame(() => {
    try {
      fit.fit();
    } catch {
      // 同上：首次挂载时容器可能还没有尺寸
    }
    push();
    term.focus();
  });
}

/* ---------- 历史回显（ghost text） ---------- */

/**
 * 历史命令（最新在前）。
 * 本地这份是**主存储**：存 localStorage，跨重启可用，不依赖外部文件是否读得到。
 * PSReadLine 的历史文件只在启动时做一次「补种」，把以前在别的窗口敲过的命令带进来。
 */
const LS_HISTORY = "md-rust.term-history";

function loadStoredHistory(): string[] {
  try {
    const raw = localStorage.getItem(LS_HISTORY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && !!item);
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(LS_HISTORY, JSON.stringify(history.slice(0, 300)));
  } catch {
    // 存满 / 被禁用时静默：历史丢了不影响终端本身
  }
}

let history: string[] = loadStoredHistory();
let seeded = false;

/** 启动时把 PSReadLine 的历史并进来一次；读不到就只用本地这份 */
async function seedHistory() {
  if (seeded) return;
  seeded = true;
  try {
    const fromShell = await invoke<string[]>("term_history", { limit: 300 });
    const seen = new Set(history);
    const merged = [...history];
    for (const cmd of fromShell) {
      if (!cmd || seen.has(cmd)) continue;
      seen.add(cmd);
      merged.push(cmd);
    }
    history = merged.slice(0, 300);
    saveHistory();
    // 补种是异步的：补进来之后要让已经打开的会话立刻用上
    for (const inst of instances.values()) updateGhost(inst);
  } catch {
    // 命令不可用（旧版本后端）时忽略，本地历史照常工作
  }
}

/** 把 onData 的原始字节镜像成「当前输入行」；认不出的控制序列直接放弃这一行的回显 */
function feed(inst: Instance, data: string) {
  if (data === "\r") {
    submit(inst);
    return;
  }
  if (data === "\x7f") {
    inst.line = inst.line.slice(0, -1);
  } else if (data === "\x15" || data === "\x03") {
    inst.line = "";
  } else if (!/[\x00-\x1f\x7f]/.test(data)) {
    inst.line += data;
  } else {
    // 方向键 / Tab 补全 / Ctrl+R：shell 的光标与缓冲区已经和镜像不同步，这一行不再建议
    inst.tracked = false;
  }
  // 这里刻意不落笔：此刻 PTY 还没回显，光标仍停在「上一个字符」的位置，
  // 现在画会让灰字先出现、再右滑一格。等回显到达（data 回调）再画，位置一次就是对的。
  if (!inst.tracked || !findSuggestion(inst.line)) clearGhost(inst);
}

function submit(inst: Instance) {
  const cmd = inst.line.trim();
  inst.line = "";
  inst.tracked = true;
  clearGhost(inst);
  if (cmd) {
    // 本会话刚跑的命令立刻可用于建议，并落盘，下次启动还在
    history = [cmd, ...history.filter((item) => item !== cmd)].slice(0, 300);
    saveHistory();
  }
}

/**
 * 把定位推迟到输出稍微安静下来之后。
 * PSReadLine 一次按键常常先回显字符、再整行重绘做语法着色，两个分片之间光标会短暂
 * 回到行首/行中；如果每个分片都立刻重定位，中间态就会被画出来 —— 这是「抖」的主因。
 */
function scheduleGhost(inst: Instance) {
  if (inst.ghostTimer) window.clearTimeout(inst.ghostTimer);
  inst.ghostTimer = window.setTimeout(() => {
    inst.ghostTimer = 0;
    // 这 32ms 里会话可能已经被关掉
    if (instances.get(inst.id) !== inst) return;
    updateGhost(inst);
  }, 32);
}

function clearGhost(inst: Instance) {
  if (inst.ghostTimer) {
    window.clearTimeout(inst.ghostTimer);
    inst.ghostTimer = 0;
  }
  if (!inst.ghost) return;
  inst.ghost.deco.dispose();
  inst.ghost.marker.dispose();
  inst.ghost = null;
}

function findSuggestion(line: string) {
  if (!line.trim()) return "";
  const lower = line.toLowerCase();
  const hit = history.find(
    (item) => item.length > line.length && item.toLowerCase().startsWith(lower),
  );
  return hit ? hit.slice(line.length) : "";
}

/**
 * 只改左侧裁剪，不移动元素、不改文本。
 * 字形一旦画在某个位置就不再动 —— 打字时是「露出的部分变少」，而不是「整段右移并重新排版」。
 * 之前每键都在改 transform 与 textContent，等于每键都让浏览器重新栅格化一次字，
 * 亚像素栅格一换就看见抖。
 */
function paintGhost(inst: Instance) {
  const g = inst.ghost;
  if (!g?.el) return;
  const grown = Math.max(0, inst.line.length - g.lineLen);
  const typed = g.hit.slice(g.lineLen, g.lineLen + grown);
  const clip = textCells(typed) * g.cellWidth;
  if (Math.abs(clip - g.appliedClip) < 0.01) return;
  g.appliedClip = clip;
  g.el.style.clipPath = clip > 0.01 ? `inset(0 0 0 ${clip.toFixed(2)}px)` : "";
}

function updateGhost(inst: Instance) {
  const rest = inst.tracked ? findSuggestion(inst.line) : "";
  if (!rest) {
    clearGhost(inst);
    return;
  }
  const hit = inst.line + rest;
  const x = inst.term.buffer.active.cursorX;
  const g = inst.ghost;
  // 命中没变、也没折行：同一段文字留在原地，只把左边裁多一格
  if (g && g.hit === hit && x >= g.baseX) {
    g.x = x;
    paintGhost(inst);
    return;
  }
  clearGhost(inst);
  try {
    renderGhost(inst, hit, rest, x);
  } catch {
    // 装饰器是 proposed API：万一升级 xterm 后签名变了，宁可没有回显，也不能让异常打断输入
  }
}

/** 单个字符占几个单元格：CJK / 全角按 2 算，否则回显会被宽度算短、右侧被裁掉 */
function cellWidth(ch: string) {
  const code = ch.codePointAt(0) ?? 0;
  return code >= 0x1100 &&
    (code <= 0x115f ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6))
    ? 2
    : 1;
}

/** 一段文本占多少单元格：CJK / 全角按 2 算 */
function textCells(text: string) {
  let cells = 0;
  for (const ch of text) cells += cellWidth(ch);
  return cells;
}

function renderGhost(inst: Instance, hit: string, full: string, x: number) {
  const term = inst.term;
  const buffer = term.buffer.active;
  // 备用缓冲区（vim / less）里没有「当前输入行」，不画
  if (buffer.type !== "normal") return;
  // 带控制符的历史（含 Tab）没法按单元格宽度画，直接放弃这条建议
  if (/[\x00-\x1f\x7f]/.test(full)) return;
  const room = term.cols - x;
  if (room <= 0) return;
  const marker = term.registerMarker(0);
  if (!marker) return;
  // 宽度按整行剩余格数预留：露出的部分只会变少，不用为它重建元素
  const deco = term.registerDecoration({ marker, x, width: room, layer: "top" });
  if (!deco) {
    marker.dispose();
    return;
  }

  const g: Ghost = {
    marker,
    deco,
    el: null,
    baseX: x,
    x,
    hit,
    full,
    lineLen: inst.line.length,
    appliedClip: 0,
    cellWidth: 0,
  };
  inst.ghost = g;

  const fontSize = term.options.fontSize ?? 13;
  const lineHeight = term.options.lineHeight ?? 1.2;
  deco.onRender((el) => {
    g.el = el;
    el.textContent = full;
    el.style.fontFamily = term.options.fontFamily ?? "";
    el.style.fontSize = `${fontSize}px`;
    // 行高必须等于 xterm 给这个格子算出的高度（13px/1.4 时是 21px，不是 18px），
    // 否则灰字会比正文高半个像素，整行看起来是斜的
    el.style.lineHeight = el.style.height || `${Math.round(fontSize * lineHeight)}px`;
    // 比正文淡一档：不抢注意力，但一眼看得出是「建议」而不是已经输入的内容
    el.style.color = "color-mix(in srgb, var(--text-tertiary) 55%, transparent)";
    el.style.whiteSpace = "pre";
    // 元素宽度是「整行剩余格数」，长建议靠这里裁掉右端，别画到终端外面
    el.style.overflow = "hidden";
    el.style.pointerEvents = "none";
    if (!g.cellWidth) {
      const widthPx = parseFloat(el.style.width || "0");
      g.cellWidth = widthPx > 0 ? widthPx / room : fontSize * 0.6;
    }
    paintGhost(inst);
  });
}

/**
 * 右方向键接受回显：把缺的那段直接写进 PTY（等价于用户自己敲完），再由 shell 回显。
 * 返回 false 表示当前没有回显，按键原样放行（普通右移不能坏）。
 */
export function acceptSuggestion(): boolean {
  const inst = instances.get(termStore.activeId);
  if (!inst?.ghost) return false;
  const rest = findSuggestion(inst.line);
  if (!rest) {
    clearGhost(inst);
    return false;
  }
  clearGhost(inst);
  inst.line += rest;
  inst.tracked = true;
  void invoke("term_write", { id: inst.id, data: rest }).catch(() => {});
  return true;
}

/** 容器尺寸变了（展开、拖动高度、切回标签）后统一重算，隐藏时的 0 尺寸不会写进 PTY。 */
export function refitAll() {  requestAnimationFrame(() => {
    for (const [id, inst] of instances) {
      try {
        inst.fit.fit();
      } catch {
        // 容器不可见时忽略
      }
      pushSize(inst.term, id);
    }
  });
}

/**
 * 新建会话。
 * `openDock` 只给「在笔记页主动开终端」的入口用 —— 终端模块的页面由路由决定可见性，
 * 不该顺手把笔记页下沿的 Dock 打开（否则从终端回到笔记，脚上会凭空多出一截终端）。
 */
export async function newSession(openDock = false) {
  if (!("__TAURI_INTERNALS__" in window)) {
    termStore.error = "终端只在桌面版可用";
    return;
  }
  termStore.error = "";

  // 先占 id、先把 xterm 挂上去，再启进程：PowerShell 的提示符常常在
  // term_open 返回之前就来了，实例没准备好就会吞掉第一屏
  const id = nextId;
  nextId += 1;
  seq += 1;
  termStore.sessions.push({ id, title: `PowerShell ${seq}`, alive: true });
  termStore.activeId = id;
  if (openDock) termStore.open = true;
  await nextTick();

  try {
    // 新会话顺手把 PSReadLine 的历史补种一次（只做一次）
    void seedHistory();
    await ensureListeners();
    await invoke("term_open", {
      id,
      cols: 100,
      rows: 24,
      // 不传工作目录：后端默认落在主盘符根（C:\），比安装目录 / 知识库目录更像终端该在的地方
      cwd: null,
    });
  } catch (err) {
    termStore.error = String(err);
    notify(String(err));
    await closeSession(id);
    if (openDock) termStore.open = true;
  }
}

/** 清屏：只清 xterm 的视口与回滚，不动 shell 状态（效果等同于终端里按 Ctrl+L） */
export function clearActive() {
  const inst = instances.get(termStore.activeId);
  if (!inst) return;
  inst.term.clear();
  inst.term.focus();
}

/** 当前会话选中的文本；没实例或没选中时返回空串 */
export function selectionText() {
  return instances.get(termStore.activeId)?.term.getSelection() ?? "";
}

export function selectAllActive() {
  const inst = instances.get(termStore.activeId);
  if (!inst) return;
  inst.term.selectAll();
  inst.term.focus();
}

/** 把系统剪贴板的内容按 xterm 的方式送进 shell（会处理换行与括号粘贴） */
export function pasteToActive(text: string) {
  const inst = instances.get(termStore.activeId);
  if (!inst || !text) return;
  inst.term.paste(text);
  inst.term.focus();
}

export async function closeSession(id: number) {
  if (!id) return;
  const inst = instances.get(id);
  if (inst) {
    inst.ro.disconnect();
    inst.term.dispose();
    instances.delete(id);
  }
  const index = termStore.sessions.findIndex((s) => s.id === id);
  if (index >= 0) termStore.sessions.splice(index, 1);
  if (termStore.activeId === id) {
    const last = termStore.sessions[termStore.sessions.length - 1];
    termStore.activeId = last ? last.id : 0;
  }
  try {
    await invoke("term_close", { id });
  } catch {
    // 进程可能已经自己退出了
  }
  if (!termStore.sessions.length) termStore.open = false;
  else refitAll();
}

export function setActive(id: number) {
  termStore.activeId = id;
  requestAnimationFrame(() => {
    const inst = instances.get(id);
    if (!inst) return;
    try {
      inst.fit.fit();
    } catch {
      // 忽略
    }
    inst.term.focus();
    pushSize(inst.term, id);
  });
}

/* ---------- 会话管理（侧栏右键用） ---------- */

export function beginRename(id: number) {
  if (!termStore.sessions.some((s) => s.id === id)) return;
  termStore.renamingId = id;
}

export function cancelRename() {
  termStore.renamingId = 0;
}

/** 提交重命名：空白名视为放弃，保留原名 */
export function renameSession(id: number, title: string) {
  const session = termStore.sessions.find((s) => s.id === id);
  const name = title.trim();
  if (session && name) session.title = name;
  termStore.renamingId = 0;
}

export async function closeOthers(id: number) {
  const others = termStore.sessions.filter((s) => s.id !== id).map((s) => s.id);
  for (const other of others) await closeSession(other);
  if (termStore.sessions.some((s) => s.id === id)) setActive(id);
}

export async function closeAll() {
  const ids = termStore.sessions.map((s) => s.id);
  for (const id of ids) await closeSession(id);
}

/** 笔记页下沿 Dock 的开关。只决定「笔记模块里露不露这一条」，与终端模块的整页无关。 */
export function toggleDock() {
  termStore.open = !termStore.open;
  if (!termStore.open) return;
  if (!termStore.sessions.length) void newSession();
  else refitAll();
}

/** 显式打开笔记页的 Dock（Ctrl+` / Ctrl+Shift+` 这类「我要看终端」的动作） */
export function openDock() {
  termStore.open = true;
  if (!termStore.sessions.length) void newSession();
  else refitAll();
}

/** 终端模块专用：保证有会话，但**不碰**笔记页 Dock 的开关 */
export function ensureSession() {
  if (!termStore.sessions.length) void newSession();
}

export function setHeight(px: number) {
  const max = Math.max(240, Math.round(window.innerHeight * 0.7));
  const next = Math.max(MIN_HEIGHT, Math.min(max, Math.round(px)));
  if (next === termStore.height) return;
  termStore.height = next;
  localStorage.setItem(LS_HEIGHT, String(next));
  refitAll();
}
