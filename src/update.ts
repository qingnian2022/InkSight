import { reactive } from "vue";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { confirm } from "@tauri-apps/plugin-dialog";

/**
 * 升级检查（手动触发）：
 *   检查 → 有新版本就弹确认 → 下载并安装（带进度）→ 提示重启 → relaunch
 *
 * 配置文件：tauri.conf.json 的 plugins.updater.endpoints 指向 Gitee 上的 latest.json；
 * 签名公钥也是配置里的 pubkey，发布包必须用对应私钥签名，否则这里会校验失败。
 */

export const updateState = reactive({
  /** 正在检查 */
  checking: false,
  /** 正在下载安装 */
  busy: false,
  /** 下载进度 0~100（未知总大小时为 -1） */
  progress: 0,
  /** 有新版本时的新版本号 */
  available: "",
  /** 给状态栏看的简短文案 */
  message: "",
  error: "",
});

let inflight = false;

export async function checkForUpdates(): Promise<void> {
  if (inflight) return;
  inflight = true;
  updateState.checking = true;
  updateState.error = "";
  updateState.message = "检查中…";
  try {
    const update = await check();
    if (!update) {
      updateState.available = "";
      updateState.message = "已是最新版本";
      window.setTimeout(() => {
        if (!updateState.busy) updateState.message = "";
      }, 4000);
      return;
    }

    updateState.available = update.version;
    updateState.message = `发现新版本 v${update.version}`;

    const go = await confirm(`发现新版本 v${update.version}${update.body ? `\n\n${update.body}` : ""}\n\n现在下载并安装吗？`, {
      title: "检查更新",
      okLabel: "下载并安装",
      cancelLabel: "稍后",
      kind: "info",
    });
    if (!go) {
      updateState.message = `有新版本 v${update.version}（已跳过）`;
      return;
    }

    updateState.busy = true;
    updateState.progress = 0;
    updateState.message = "准备下载…";

    let total = 0;
    let received = 0;
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? 0;
          updateState.message = total ? `下载中 0 / ${formatBytes(total)}` : "下载中…";
          break;
        case "Progress":
          received += event.data.chunkLength ?? 0;
          updateState.progress = total ? Math.min(100, Math.round((received / total) * 100)) : -1;
          updateState.message = total
            ? `下载中 ${formatBytes(received)} / ${formatBytes(total)}（${updateState.progress}%）`
            : `下载中 ${formatBytes(received)}`;
          break;
        case "Finished":
          updateState.progress = 100;
          updateState.message = "下载完成，正在安装…";
          break;
      }
    });

    updateState.message = "安装完成";
    updateState.busy = false;
    updateState.progress = 0;

    const restart = await confirm("新版本已安装，需要重启应用才能生效。现在重启吗？", {
      title: "升级完成",
      okLabel: "立即重启",
      cancelLabel: "稍后手动重启",
      kind: "info",
    });
    if (restart) await relaunch();
    else updateState.message = "重启后生效";
  } catch (err) {
    updateState.error = errorText(err);
    updateState.message = "检查更新失败";
    window.setTimeout(() => {
      updateState.error = "";
      updateState.message = "";
    }, 8000);
  } finally {
    updateState.checking = false;
    inflight = false;
  }
}

function formatBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/endpoint|failed to fetch|Network|dns|http/i.test(raw)) {
    return "无法访问更新服务器（检查 endpoints 地址或网络）";
  }
  if (/signature|verify/i.test(raw)) {
    return "安装包签名校验失败";
  }
  return raw.slice(0, 160);
}
