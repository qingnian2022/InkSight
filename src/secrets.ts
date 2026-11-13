import { invoke } from "@tauri-apps/api/core";
import { computed, reactive } from "vue";
import { notify } from "./store";
import { openConfirm } from "./ui/confirmPrompt";

/**
 * 凭据库前端状态。
 * 数据由后端加密写在安装目录 `data/.secrets/`，这里只持有一份内存副本。
 */

/** 分类不再枚举：这四个是内置的，其余由用户自己加，存的就是显示名 */
export const PRESET_CATEGORIES = ["登录", "API Key", "数据库", "其他"];

/** "all" 表示不过滤，其余直接是分类名 */
export type CategoryFilter = string;

/** 旧版本存的是英文键，读入时换成显示名 */
const LEGACY_CATEGORY: Record<string, string> = {
  login: "登录",
  apikey: "API Key",
  database: "数据库",
  other: "其他",
};

export interface SecretItem {
  id: string;
  name: string;
  category: string;
  username: string;
  secret: string;
  url: string;
  note: string;
  updated: number;
}

/** 分类色调：内置四项固定配色，自定义按名称哈希取后两色，保证同名同色 */
const TONES = [
  { dot: "#534AB7", ink: "#3C3489" },
  { dot: "#BA7517", ink: "#854F0B" },
  { dot: "#0F6E56", ink: "#085041" },
  { dot: "#185FA5", ink: "#0C447C" },
  { dot: "#A23B72", ink: "#7A2A56" },
  { dot: "#5F6B66", ink: "#3A4441" },
];

export function categoryTone(name: string) {
  const preset = PRESET_CATEGORIES.indexOf(name);
  if (preset >= 0) return TONES[preset];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 9973;
  return TONES[4 + (hash % 2)];
}

function blank(): SecretItem {
  return {
    id: "",
    name: "",
    category: PRESET_CATEGORIES[0],
    username: "",
    secret: "",
    url: "",
    note: "",
    updated: 0,
  };
}

export const secretsStore = reactive({
  items: [] as SecretItem[],
  loading: false,
  query: "",
  /** "all" 或分类名 */
  filter: "all",
  selectedId: "",
  revealed: false,
  editing: blank(),
  /** 编辑器是否打开；editing 始终是对象，模板里不用做空值判断 */
  editingOpen: false,
  saving: false,
  location: "",
});

export const visibleSecrets = computed(() => {
  const q = secretsStore.query.trim().toLowerCase();
  return secretsStore.items.filter((item) => {
    if (secretsStore.filter !== "all" && item.category !== secretsStore.filter) return false;
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.username.toLowerCase().includes(q) ||
      item.url.toLowerCase().includes(q) ||
      item.note.toLowerCase().includes(q)
    );
  });
});

export const selectedSecret = computed(
  () => secretsStore.items.find((item) => item.id === secretsStore.selectedId) ?? null,
);

/** 胶囊：内置分类按固定顺序在前，自定义按首次出现顺序在后；空分类不占位 */
export const categoryFilters = computed(() => {
  const counts = new Map<string, number>();
  for (const item of secretsStore.items) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  const custom = [...counts.keys()].filter((name) => !PRESET_CATEGORIES.includes(name));
  const order = [...PRESET_CATEGORIES.filter((name) => counts.has(name)), ...custom];
  return [
    { name: "all", label: "全部", count: secretsStore.items.length },
    ...order.map((name) => ({ name, label: name, count: counts.get(name) ?? 0 })),
  ];
});

/** 编辑器里可选的分类：内置 + 已经用过的自定义 */
export const editorCategories = computed(() => {
  const used = [...new Set(secretsStore.items.map((item) => item.category))];
  return [...PRESET_CATEGORIES, ...used.filter((name) => !PRESET_CATEGORIES.includes(name))];
});

export function countOf(category: CategoryFilter) {
  return category === "all"
    ? secretsStore.items.length
    : secretsStore.items.filter((item) => item.category === category).length;
}

export async function loadSecrets() {
  secretsStore.loading = true;
  try {
    const list = await invoke<SecretItem[]>("secrets_list");
    secretsStore.items = list.map((item) => ({
      ...item,
      category: LEGACY_CATEGORY[item.category] ?? item.category ?? "其他",
    }));
    if (!secretsStore.items.some((item) => item.id === secretsStore.selectedId)) {
      secretsStore.selectedId = secretsStore.items[0]?.id ?? "";
    }
  } catch (err) {
    notify(String(err));
  } finally {
    secretsStore.loading = false;
  }
}

export async function loadLocation() {
  try {
    secretsStore.location = await invoke<string>("secrets_location");
  } catch {
    secretsStore.location = "";
  }
}

export function selectSecret(id: string) {
  secretsStore.selectedId = id;
  secretsStore.revealed = false;
}

export function startCreate() {
  secretsStore.editing = blank();
  secretsStore.editingOpen = true;
}

export function startEdit(item: SecretItem) {
  secretsStore.editing = { ...item };
  secretsStore.editingOpen = true;
}

export function cancelEdit() {
  secretsStore.editingOpen = false;
}

export async function saveEditing() {
  const draft = secretsStore.editing;
  if (!secretsStore.editingOpen || !draft.name.trim() || secretsStore.saving) return;
  secretsStore.saving = true;
  try {
    const saved = await invoke<SecretItem>("secrets_save", {
      item: { ...draft, name: draft.name.trim() },
    });
    secretsStore.editingOpen = false;
    await loadSecrets();
    selectSecret(saved.id);
    notify("已保存");
  } catch (err) {
    notify(String(err));
  } finally {
    secretsStore.saving = false;
  }
}

export async function removeSecret(item: SecretItem) {
  const ok = await openConfirm({
    title: "删除凭据",
    message: `确定删除「${item.name}」？`,
    detail: "删除后无法恢复，且不会进入回收站。",
    okText: "删除",
    danger: true,
  });
  if (!ok) return;
  try {
    await invoke("secrets_remove", { id: item.id });
    if (secretsStore.selectedId === item.id) secretsStore.selectedId = "";
    await loadSecrets();
  } catch (err) {
    notify(String(err));
  }
}

export async function copySecret(text: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    notify("已复制");
  } catch (err) {
    notify(String(err));
  }
}

export function formatUpdated(seconds: number) {
  if (!seconds) return "—";
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(seconds * 1000).toLocaleDateString("zh-CN");
}
