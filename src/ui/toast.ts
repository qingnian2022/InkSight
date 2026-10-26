import { reactive } from "vue";

/** 轻量全局提示（右下浮动提示条），比状态栏文字更容易被看到。 */
export const toastState = reactive({
  open: false,
  text: "",
  kind: "info" as "info" | "error",
  /** 每次弹出自增，用于触发重新计时/动画 */
  seq: 0,
});

let timer: number | undefined;

export function showToast(text: string, kind: "info" | "error" = "info", duration = 2600) {
  toastState.text = text;
  toastState.kind = kind;
  toastState.open = true;
  toastState.seq += 1;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    toastState.open = false;
  }, duration);
}

export function hideToast() {
  window.clearTimeout(timer);
  toastState.open = false;
}
