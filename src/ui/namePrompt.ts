import { reactive } from "vue";

/**
 * 输入名称的小弹窗（Promise 风格）。
 * Tauri 的 WebView 不支持 window.prompt，新建 / 重命名统一走这里。
 */
export const namePromptState = reactive({
  open: false,
  title: "",
  value: "",
  confirmText: "确定",
  /** 有值时显示「保存到 <folder>」一行（新文档落盘用）；调用方在 resolve 后读取。 */
  folder: null as string | null,
  resolve: null as ((value: string | null) => void) | null,
});

export function openNamePrompt(options: {
  title: string;
  initial?: string;
  confirmText?: string;
  folder?: string;
}): Promise<string | null> {
  // 已有弹窗未关闭时，旧的等待直接取消，避免悬挂
  if (namePromptState.resolve) namePromptState.resolve(null);
  namePromptState.title = options.title;
  namePromptState.value = options.initial ?? "";
  namePromptState.confirmText = options.confirmText ?? "确定";
  namePromptState.folder = options.folder ?? null;
  namePromptState.open = true;
  return new Promise((resolve) => {
    namePromptState.resolve = resolve;
  });
}

export function finishNamePrompt(value: string | null) {
  namePromptState.open = false;
  const resolve = namePromptState.resolve;
  namePromptState.resolve = null;
  resolve?.(value);
}
