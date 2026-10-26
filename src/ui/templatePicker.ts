import { reactive } from "vue";
import { templateDelete, templateList } from "../api";

/**
 * 新建文档的模板选择器（Promise 风格，和 namePrompt 同一套交互）。
 * - 内置模板：空白 / 日记 / 会议纪要 / 读书笔记
 * - 自定义模板：知识库 `.templates/*.md`，文件名即模板名，可删除
 * - 占位符（新建文档时求值）：
 *     {{date}}                 2026-10-26
 *     {{date:YYYY年M月D日}}     2026年10月26日
 *     {{time}}                 14:30
 *     {{time:HH:mm:ss}}        14:30:05
 *     {{datetime}}             2026-10-26 14:30
 *     {{weekday}}              周一
 *     {{title}}                文档标题
 *   格式符：YYYY YY MM M DD D HH H mm ss ddd
 */

export interface DocTemplate {
  id: string;
  name: string;
  desc: string;
  content: string;
  custom?: boolean;
}

const LS_DEFAULT_TPL = "md-rust.tplDefault";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 支持的格式符；用一次性正则替换，避免 M 把 MM 的结果再吃掉 */
const FMT_TOKEN = /YYYY|YY|MM|M|DD|D|HH|H|mm|ss|ddd/g;

function formatDate(d: Date, fmt: string): string {
  const map: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(2),
    MM: pad(d.getMonth() + 1),
    M: String(d.getMonth() + 1),
    DD: pad(d.getDate()),
    D: String(d.getDate()),
    HH: pad(d.getHours()),
    H: String(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
    ddd: WEEKDAYS[d.getDay()],
  };
  return fmt.replace(FMT_TOKEN, (token) => map[token] ?? token);
}

function today(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowTime(d = new Date()): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function applyTemplate(content: string, title: string): string {
  const d = new Date();
  return content
    .replace(/\{\{\s*date\s*:\s*([^}]+?)\s*\}\}/g, (_m, f: string) => formatDate(d, f.trim()))
    .replace(/\{\{\s*date\s*\}\}/g, today(d))
    .replace(/\{\{\s*time\s*:\s*([^}]+?)\s*\}\}/g, (_m, f: string) => formatDate(d, f.trim()))
    .replace(/\{\{\s*time\s*\}\}/g, nowTime(d))
    .replace(/\{\{\s*datetime\s*\}\}/g, `${today(d)} ${nowTime(d)}`)
    .replace(/\{\{\s*weekday\s*\}\}/g, WEEKDAYS[d.getDay()])
    .replace(/\{\{\s*title\s*\}\}/g, title);
}

export const BUILTIN_TEMPLATES: DocTemplate[] = [
  { id: "blank", name: "空白文档", desc: "直接开始写", content: "" },
  {
    id: "daily",
    name: "日记",
    desc: "# 2026-10-21 日记",
    content: "# {{date}} 日记\n\n## 今日要事\n\n- \n\n## 随想\n\n",
  },
  {
    id: "meeting",
    name: "会议纪要",
    desc: "时间 / 参会 / 结论",
    content:
      "# {{title}}\n\n- 时间：{{date}} {{time}}\n- 参会：\n\n## 议题\n\n## 结论\n\n## 待办\n\n- [ ] \n",
  },
  {
    id: "reading",
    name: "读书笔记",
    desc: "摘录 / 感想 / 行动",
    content:
      "# {{title}}\n\n- 书名：\n- 作者：\n- 日期：{{date}}\n\n## 摘录\n\n## 感想\n\n## 行动\n\n",
  },
];

/** 读取知识库 `.templates/*.md` 作为自定义模板；读不到就返回空数组（不报错）。 */
export async function loadCustomTemplates(root: string | null): Promise<DocTemplate[]> {
  if (!root) return [];
  try {
    const list = await templateList(root);
    return list.map((item) => ({
      id: `custom:${item.path}`,
      name: item.name,
      desc: firstLine(item.content),
      content: item.content,
      custom: true,
    }));
  } catch {
    return [];
  }
}

function firstLine(content: string): string {
  const line = content.split("\n").find((l) => l.trim()) ?? "";
  return line.replace(/^#+\s*/, "").trim().slice(0, 18) || "自定义模板";
}

/** 删除自定义模板；若删的正好是默认模板，顺带清掉默认设置。 */
export async function deleteCustomTemplate(root: string | null, tpl: DocTemplate): Promise<void> {
  if (!root || !tpl.custom) return;
  const path = tpl.id.replace(/^custom:/, "");
  await templateDelete(root, path);
  if (getDefaultTemplateId() === tpl.id) setDefaultTemplateId(null);
  const customs = await loadCustomTemplates(root);
  templatePickerState.items = [...BUILTIN_TEMPLATES, ...customs];
  if (templatePickerState.selectedId === tpl.id) templatePickerState.selectedId = "blank";
}

export function getDefaultTemplateId(): string | null {
  try {
    return localStorage.getItem(LS_DEFAULT_TPL);
  } catch {
    return null;
  }
}

export function setDefaultTemplateId(id: string | null) {
  try {
    if (id) localStorage.setItem(LS_DEFAULT_TPL, id);
    else localStorage.removeItem(LS_DEFAULT_TPL);
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

export const templatePickerState = reactive({
  open: false,
  items: [] as DocTemplate[],
  selectedId: "blank",
  asDefault: false,
  resolve: null as ((tpl: DocTemplate | null) => void) | null,
});

/**
 * 打开模板选择器。返回所选模板（含内容），取消返回 null。
 * 默认模板存续时，调用方可以自行决定是否跳过弹窗。
 */
export async function openTemplatePicker(root: string | null): Promise<DocTemplate | null> {
  if (templatePickerState.resolve) templatePickerState.resolve(null);
  const customs = await loadCustomTemplates(root);
  templatePickerState.items = [...BUILTIN_TEMPLATES, ...customs];
  templatePickerState.selectedId = getDefaultTemplateId() ?? "blank";
  templatePickerState.asDefault = false;
  templatePickerState.open = true;
  return new Promise((resolve) => {
    templatePickerState.resolve = resolve;
  });
}

export function finishTemplatePicker(tpl: DocTemplate | null) {
  templatePickerState.open = false;
  if (tpl && templatePickerState.asDefault) setDefaultTemplateId(tpl.id);
  const resolve = templatePickerState.resolve;
  templatePickerState.resolve = null;
  resolve?.(tpl);
}

/** 「+」入口：有默认模板直接用；否则弹选择器。 */
export async function pickTemplate(root: string | null, forcePicker = false): Promise<DocTemplate | null> {
  const defId = getDefaultTemplateId();
  if (defId && !forcePicker) {
    const customs = await loadCustomTemplates(root);
    const all = [...BUILTIN_TEMPLATES, ...customs];
    const hit = all.find((t) => t.id === defId);
    if (hit) return hit;
  }
  return openTemplatePicker(root);
}
