import { reactive } from "vue";
import { templateList } from "../api";

/**
 * 新建文档的模板选择器（Promise 风格，和 namePrompt 同一套交互）。
 * - 内置模板：空白 / 日记 / 会议纪要 / 读书笔记
 * - 自定义模板：知识库 `.templates/*.md`，文件名即模板名
 * - 占位符：{{date}} 今天日期、{{time}} 当前时间、{{title}} 文档标题
 */

export interface DocTemplate {
  id: string;
  name: string;
  desc: string;
  content: string;
  custom?: boolean;
}

const LS_DEFAULT_TPL = "md-rust.tplDefault";

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function nowTime(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function applyTemplate(content: string, title: string): string {
  return content
    .replace(/\{\{date\}\}/g, today())
    .replace(/\{\{time\}\}/g, nowTime())
    .replace(/\{\{title\}\}/g, title);
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
