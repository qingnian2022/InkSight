import { reactive } from "vue";

/**
 * 主题内确认弹窗（Promise 风格），替代系统 dialog。
 * Tauri 的 plugin-dialog 是原生窗口，和皮肤不搭，删除类确认统一走这里。
 */
export const confirmPromptState = reactive({
  open: false,
  title: "确认",
  message: "",
  /** 次要说明（灰字，可空） */
  detail: "",
  okText: "确定",
  cancelText: "取消",
  danger: false,
  resolve: null as ((ok: boolean) => void) | null,
});

export function openConfirm(options: {
  title?: string;
  message: string;
  detail?: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
}): Promise<boolean> {
  // 已有弹窗未关闭时，旧的等待直接按「取消」处理，避免悬挂
  if (confirmPromptState.resolve) confirmPromptState.resolve(false);
  confirmPromptState.title = options.title ?? "确认";
  confirmPromptState.message = options.message;
  confirmPromptState.detail = options.detail ?? "";
  confirmPromptState.okText = options.okText ?? "确定";
  confirmPromptState.cancelText = options.cancelText ?? "取消";
  confirmPromptState.danger = options.danger ?? false;
  confirmPromptState.open = true;
  return new Promise((resolve) => {
    confirmPromptState.resolve = resolve;
  });
}

export function finishConfirm(ok: boolean) {
  confirmPromptState.open = false;
  const resolve = confirmPromptState.resolve;
  confirmPromptState.resolve = null;
  resolve?.(ok);
}
