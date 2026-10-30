/**
 * 头像上传：本地压缩到 128×128 的 JPEG data URL，避免把大图塞进同步接口。
 * 服务端限制 200_000 字符，这里压到 ~60KB 以内再返回。
 */
const MAX_SIDE = 128;
const MAX_CHARS = 120_000;

async function encode(file: File, side: number, quality: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前环境不支持图片处理");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, side, side);

  // 居中裁切正方形
  const scale = Math.max(side / bitmap.width, side / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (side - w) / 2, (side - h) / 2, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", quality);
}

export async function fileToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
  if (file.size > 8 * 1024 * 1024) throw new Error("图片不能超过 8MB");

  let data = await encode(file, MAX_SIDE, 0.86);
  if (data.length > MAX_CHARS) data = await encode(file, MAX_SIDE, 0.7);
  if (data.length > MAX_CHARS) data = await encode(file, 96, 0.62);
  if (data.length > MAX_CHARS) throw new Error("图片压缩后仍然过大，请换一张");
  return data;
}

export function isImageAvatar(value: string): boolean {
  return value.startsWith("data:image/");
}

export function avatarStyle(value: string): Record<string, string> {
  if (isImageAvatar(value)) {
    return {
      backgroundImage: `url(${value})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
      color: "transparent",
    };
  }
  return { background: value };
}
