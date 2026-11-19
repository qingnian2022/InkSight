import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { reactive } from "vue";
import { notify } from "./store";
import { openConfirm } from "./ui/confirmPrompt";

/**
 * SFTP 的前端状态。
 *
 * 连接配置（含密码）由后端写到 `<数据目录>/.sftp.json`，点开头所以不会出现在笔记目录树里。
 * 密码是**明文**存的 —— 用户明确要求放在本地安装目录，仅适合个人机器。
 * 会话句柄在后端，这里只拿 id。
 */

export interface SftpEntry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  modified: number;
}

export interface LocalEntry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  modified: number;
}

export interface SftpProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  keyPath: string;
  password: string;
}

export type TransferStatus = "queued" | "running" | "done" | "error" | "canceled";

export interface TransferItem {
  id: number;
  /** 展示名（远端文件名） */
  name: string;
  remotePath: string;
  localDir: string;
  /** 入队时的连接 id：队列跑起来后用户可能切走连接 */
  connId: number;
  done: number;
  total: number;
  status: TransferStatus;
  /** 当前正在传的文件（目录下载时会变） */
  label: string;
  error?: string;
}

export interface SftpConn {
  id: number;
  profileId: string;
  name: string;
  host: string;
  user: string;
}

export const sftpStore = reactive({
  profiles: [] as SftpProfile[],
  conns: [] as SftpConn[],
  activeId: 0,
  path: "",
  entries: [] as SftpEntry[],
  selected: null as SftpEntry | null,
  loading: false,
  /** 传输队列：顺序执行，因为后端同一时刻只有一个 SFTP 通道 */
  transfers: [] as TransferItem[],
  /** 远端多选 */
  selectedPaths: [] as string[],
  /** 正在拖拽的远端路径集合 */
  dragPaths: [] as string[],
  /** "" | "remote" | "local"：正在哪一栏新建文件夹 */
  creating: "" as "" | "remote" | "local",
  newFolder: "",
  /** 正在连接中的配置 id（侧栏显示「连接中…」并防重复点击） */
  connectingId: "",
  error: "",
  /** 侧栏点了「未连接」的配置，主区表单用它预填 */
  draft: null as SftpProfile | null,
  /* 左栏：本地 */
  localPath: "",
  localEntries: [] as LocalEntry[],
  localSelected: null as LocalEntry | null,
  /** 本地多选 */
  localSelectedPaths: [] as string[],
  /** 正在内联重命名的远端路径 */
  renamingPath: "",
});

export function activeConn() {
  return sftpStore.conns.find((c) => c.id === sftpStore.activeId) ?? null;
}

export function connOf(profileId: string) {
  return sftpStore.conns.find((c) => c.profileId === profileId) ?? null;
}

/* ---------- 连接配置（后端落盘） ---------- */

export async function loadProfiles() {
  try {
    const list = await invoke<SftpProfile[]>("sftp_profiles_load");
    if (Array.isArray(list)) sftpStore.profiles = list;
  } catch {
    // 老版本后端没有这条命令时保持空列表，不影响手动填表连接
  }
}

async function persistProfiles() {
  try {
    await invoke("sftp_profiles_save", { profiles: sftpStore.profiles });
  } catch (err) {
    notify(String(err));
  }
}

export function upsertProfile(profile: SftpProfile) {
  const index = sftpStore.profiles.findIndex((p) => p.id === profile.id);
  if (index >= 0) sftpStore.profiles[index] = profile;
  else sftpStore.profiles.push(profile);
  void persistProfiles();
}

export function removeProfile(id: string) {
  sftpStore.profiles = sftpStore.profiles.filter((p) => p.id !== id);
  void persistProfiles();
}

/* ---------- 远端 ---------- */

export async function connect(profile: SftpProfile) {
  sftpStore.error = "";
  sftpStore.loading = true;
  sftpStore.connectingId = profile.id;
  try {
    const id = await invoke<number>("sftp_connect", {
      host: profile.host.trim(),
      port: profile.port || 22,
      user: profile.user.trim(),
      password: profile.password || null,
      keyPath: profile.keyPath.trim() || null,
      passphrase: null,
    });
    // 同一个配置重复连接时，先把旧会话断掉
    const old = connOf(profile.id);
    if (old) {
      sftpStore.conns = sftpStore.conns.filter((c) => c.id !== old.id);
      void invoke("sftp_disconnect", { id: old.id }).catch(() => {});
    }
    sftpStore.conns.push({
      id,
      profileId: profile.id,
      name: profile.name || profile.host,
      host: profile.host,
      user: profile.user,
    });
    sftpStore.activeId = id;
    upsertProfile({ ...profile, name: profile.name || profile.host });
    await list("");
    if (!sftpStore.localEntries.length) await loadLocal(sftpStore.localPath);
  } catch (err) {
    sftpStore.error = String(err);
    notify(String(err));
    // 连接失败时把配置丢回表单：密码可能过期了，直接改比重填快
    sftpStore.draft = { ...profile };
  } finally {
    sftpStore.loading = false;
    sftpStore.connectingId = "";
  }
}

export async function list(path: string) {
  const id = sftpStore.activeId;
  if (!id) return;
  sftpStore.loading = true;
  sftpStore.error = "";
  try {
    const res = await invoke<{ path: string; entries: SftpEntry[] }>("sftp_list", { id, path });
    sftpStore.path = res.path;
    sftpStore.entries = res.entries;
    sftpStore.selected = null;
    sftpStore.selectedPaths = [];
  } catch (err) {
    sftpStore.error = String(err);
  } finally {
    sftpStore.loading = false;
  }
}

export function up() {
  const path = sftpStore.path;
  if (!path || path === "/") return;
  const parent = path.replace(/\/+$/, "");
  const cut = parent.lastIndexOf("/");
  void list(cut > 0 ? parent.slice(0, cut) : "/");
}

export function enter(entry: SftpEntry) {
  if (!entry.dir) return;
  void list(entry.path);
}

export function activate(id: number) {
  if (sftpStore.activeId === id) return;
  sftpStore.activeId = id;
  sftpStore.entries = [];
  sftpStore.path = "";
  void list("");
}

export async function disconnect(id: number) {
  try {
    await invoke("sftp_disconnect", { id });
  } catch {
    // 后端可能已经断开
  }
  sftpStore.conns = sftpStore.conns.filter((c) => c.id !== id);
  if (sftpStore.activeId === id) {
    sftpStore.activeId = 0;
    sftpStore.entries = [];
    sftpStore.path = "";
    const next = sftpStore.conns[0];
    if (next) activate(next.id);
  }
}

/* ---------- 本地 ---------- */

export async function loadLocal(path: string) {
  try {
    const res = await invoke<{ path: string; entries: LocalEntry[] }>("local_list", { path });
    sftpStore.localPath = res.path;
    sftpStore.localEntries = res.entries;
    sftpStore.localSelected = null;
    sftpStore.localSelectedPaths = [];
  } catch (err) {
    notify(String(err));
  }
}

export function localEnter(entry: LocalEntry) {
  if (entry.dir) void loadLocal(entry.path);
}

export function localUp() {
  const path = sftpStore.localPath;
  if (!path) return;
  const trimmed = path.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (cut < 0) {
    void loadLocal("");
    return;
  }
  let parent = trimmed.slice(0, cut);
  // "C:\Users" → "C:" → 盘符根要补回反斜杠；再上一级才是「此电脑」
  if (/^[A-Za-z]:$/.test(parent)) parent = `${parent}\\`;
  void loadLocal(parent);
}

/* ---------- 下载 ---------- */

let transferSeq = 0;
let queueRunning = false;
let eventsBound = false;

/** 进度事件全局只订阅一次（App 启动时调）；按 transferId 找到对应那一项 */
export async function initSftpEvents() {
  if (eventsBound) return;
  eventsBound = true;
  await listen<{ transferId: number; name: string; done: number; total: number }>(
    "sftp://progress",
    (event) => {
      const item = sftpStore.transfers.find((t) => t.id === event.payload.transferId);
      if (!item) return;
      item.done = event.payload.done;
      item.total = event.payload.total;
      if (event.payload.name) item.label = event.payload.name;
    },
  );
}

/** 入队；真正开始由 runQueue 顺序执行 */
export function downloadTo(remotePath: string, localDir: string) {
  if (!sftpStore.activeId || !remotePath || !localDir) return;
  const name = remotePath.replace(/\/+$/, "").split("/").pop() || remotePath;
  sftpStore.transfers.push({
    id: ++transferSeq,
    name,
    remotePath,
    localDir,
    connId: sftpStore.activeId,
    done: 0,
    total: 0,
    status: "queued",
    label: "",
  });
  sftpStore.error = "";
  void runQueue();
}

/** 一次拖多个：逐个入队，顺序执行 */
export function downloadMany(paths: string[], localDir: string) {
  for (const path of paths) downloadTo(path, localDir);
}

async function runQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    for (;;) {
      const next = sftpStore.transfers.find((item) => item.status === "queued");
      if (!next) break;
      next.status = "running";
      try {
        const saved = await invoke<string>("sftp_download", {
          id: next.connId,
          transferId: next.id,
          remotePath: next.remotePath,
          localDir: next.localDir,
        });
        next.status = "done";
        next.done = next.total || next.done;
        notify("已下载：" + saved);
      } catch (err) {
        const message = String(err);
        next.status = message.includes("已取消") ? "canceled" : "error";
        if (next.status === "error") {
          next.error = message;
          sftpStore.error = message;
          notify(message);
        }
      }
      await loadLocal(sftpStore.localPath);
    }
  } finally {
    queueRunning = false;
  }
}

/** 取消某一项：排队中的直接标记，进行中的让后端在下一个分块停下 */
export async function cancelTransfer(id?: number) {
  const target = id ?? sftpStore.transfers.find((t) => t.status === "running")?.id;
  if (!target) return;
  const item = sftpStore.transfers.find((t) => t.id === target);
  if (!item) return;
  if (item.status === "queued") {
    item.status = "canceled";
    return;
  }
  if (item.status !== "running") return;
  try {
    await invoke("sftp_cancel", { transferId: item.id });
  } catch {
    // 可能刚好结束
  }
}

/** 清掉已完成/已取消/失败的记录，只留下还在跑的 */
export function clearFinishedTransfers() {
  sftpStore.transfers = sftpStore.transfers.filter(
    (t) => t.status === "queued" || t.status === "running",
  );
}

/** 删除本地文件 / 目录：多选时一次删完，先进应用内确认 */
export async function removeLocal(entry: LocalEntry) {
  const selected = sftpStore.localEntries.filter((item) =>
    sftpStore.localSelectedPaths.includes(item.path),
  );
  const targets = selected.some((item) => item.path === entry.path) ? selected : [entry];

  // 盘符根（C:////）是分区本身，删不得
  if (targets.some((item) => /^[A-Za-z]:[\\/]?$/.test(item.path))) {
    notify("不能删除磁盘分区");
    return;
  }

  const ok = await openConfirm({
    title: "删除本地项目",
    message:
      targets.length > 1
        ? "确定删除选中的 " + targets.length + " 项？"
        : "确定删除「" + targets[0].name + "」？",
    detail: "删除后不进回收站，无法恢复。",
    okText: "删除",
    danger: true,
  });
  if (!ok) return;

  let failed = 0;
  for (const item of targets) {
    try {
      await invoke("local_remove", { path: item.path });
    } catch {
      failed += 1;
    }
  }
  if (failed) notify(failed + " 项删除失败");
  else notify("已删除 " + targets.length + " 项");
  await loadLocal(sftpStore.localPath);
}

/* ---------- 新建文件夹 ---------- */

export function startCreateFolder(kind: "remote" | "local") {
  sftpStore.creating = kind;
  sftpStore.newFolder = "";
}

export function cancelCreateFolder() {
  sftpStore.creating = "";
  sftpStore.newFolder = "";
}

export async function commitCreateFolder() {
  const name = sftpStore.newFolder.trim();
  const kind = sftpStore.creating;
  if (!kind || !name) {
    cancelCreateFolder();
    return;
  }
  cancelCreateFolder();
  // 「此电脑」盘符列表没有具体目录，建不了
  if (kind === "local" && !sftpStore.localPath) {
    notify("先进入一个磁盘分区再新建文件夹");
    return;
  }
  try {
    if (kind === "remote") {
      const base = sftpStore.path.replace(/\/+$/, "");
      await invoke("sftp_mkdir", { id: sftpStore.activeId, path: `${base}/${name}` });
      await list(sftpStore.path);
    } else {
      const base = sftpStore.localPath.replace(/[\\/]+$/, "");
      // 盘符根是 "C:\"，去掉尾斜杠后变 "C:"，join 时要补回分隔符
      const sep = base.includes("\\") ? "\\" : "/";
      await invoke("local_mkdir", { path: `${base}${sep}${name}` });
      await loadLocal(sftpStore.localPath);
    }
  } catch (err) {
    notify(String(err));
  }
}

/** 拖到了没有具体目录的地方（比如「此电脑」列表）：弹一次目录选择 */
export async function downloadWithPicker(remotePath: string) {
  const picked = await open({ directory: true, title: "选择保存位置" });
  if (typeof picked === "string") await downloadTo(remotePath, picked);
}

/** 一次拖多个且没有落地目录：只弹一次，选完统一入队 */
export async function downloadManyWithPicker(paths: string[]) {
  const picked = await open({ directory: true, title: "选择保存位置" });
  if (typeof picked === "string") downloadMany(paths, picked);
}

/** 「下载」按钮 / 双击文件：优先进当前本地目录，没有就弹目录选择 */
export async function downloadPath(remotePath: string) {
  let target = sftpStore.localPath;
  if (!target) {
    const picked = await open({ directory: true, title: "选择保存位置" });
    if (!picked || typeof picked !== "string") return;
    target = picked;
  }
  await downloadTo(remotePath, target);
}

export async function download(entry: SftpEntry | null) {
  if (!entry) return;
  await downloadPath(entry.path);
}

/* ---------- 远端改名 / 删除 ---------- */

export function beginRename(path: string) {
  sftpStore.renamingPath = path;
}

export function cancelRename() {
  sftpStore.renamingPath = "";
}

export async function commitRename(entry: SftpEntry, name: string) {
  const next = name.trim();
  sftpStore.renamingPath = "";
  if (!next || next === entry.name) return;
  const parent = entry.path.slice(0, entry.path.lastIndexOf("/"));
  try {
    await invoke("sftp_rename", {
      id: sftpStore.activeId,
      from: entry.path,
      to: `${parent}/${next}`,
    });
    await list(sftpStore.path);
  } catch (err) {
    notify(String(err));
  }
}

export async function removeEntry(entry: SftpEntry) {
  const ok = await openConfirm({
    title: "删除远端项目",
    message: `确定删除「${entry.name}」？`,
    detail: entry.dir ? "目录会连同内部所有文件一起删除，不可恢复。" : "删除后不可恢复。",
    okText: "删除",
    danger: true,
  });
  if (!ok) return;
  try {
    await invoke("sftp_remove", { id: sftpStore.activeId, path: entry.path });
    notify(`已删除：${entry.name}`);
    await list(sftpStore.path);
  } catch (err) {
    notify(String(err));
  }
}
