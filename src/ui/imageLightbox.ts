import { reactive } from "vue";

/** 图片点击放大（语雀式暗色遮罩）。富文本区的点击监听放在 RichEditor 里。 */
export const imageLightboxState = reactive({
  open: false,
  src: "",
  caption: "",
});

export function openImageLightbox(src: string, caption: string) {
  if (!src) return;
  imageLightboxState.src = src;
  imageLightboxState.caption = caption;
  imageLightboxState.open = true;
}

export function closeImageLightbox() {
  imageLightboxState.open = false;
}
