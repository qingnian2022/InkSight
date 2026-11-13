import { computed, reactive } from "vue";
import { WORK_MODULES, type WorkModule } from "./store";

/**
 * 界面设置（目前只有「功能开放」）。
 *
 * 规则：笔记永远开启；文件 / 终端 / 搜索默认关闭，打开后才出现在活动栏。
 * 只开笔记时活动栏整条隐藏 —— 回到纯粹的写作界面。
 */

export type FeatureKey = "files" | "terminal" | "search";

const LS = "md-rust.features";

function readFeatures(): Record<FeatureKey, boolean> {
  const off: Record<FeatureKey, boolean> = { files: false, terminal: false, search: false };
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return off;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return off;
    const row = parsed as Record<string, unknown>;
    return {
      files: row.files === true,
      terminal: row.terminal === true,
      search: row.search === true,
    };
  } catch {
    return off;
  }
}

export const settingsStore = reactive({
  open: false,
  features: readFeatures(),
});

export function setFeature(key: FeatureKey, on: boolean) {
  settingsStore.features[key] = on;
  try {
    localStorage.setItem(LS, JSON.stringify(settingsStore.features));
  } catch {
    // 存不进去也不影响本次会话
  }
}

export function featureOn(key: WorkModule) {
  return key === "notes" ? true : settingsStore.features[key as FeatureKey];
}

/** 活动栏上要显示哪些模块（笔记恒在） */
export const visibleModules = computed(() =>
  WORK_MODULES.filter((m) => featureOn(m.key)),
);

/** 只剩笔记时不显示活动栏 */
export const railVisible = computed(() => visibleModules.value.length > 1);

export function openSettings() {
  settingsStore.open = true;
}

export function closeSettings() {
  settingsStore.open = false;
}
