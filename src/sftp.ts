import { invoke } from "@tauri-apps/api/core";
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
  busy: "",
  /** 正在连接中的配置 id（侧栏显示「连接中…」并防重复点击） */
  connectingId: "",
  error: "",
  /** 侧栏点了「未连接」的配置，主区表单用它预填 */
  draft: null as SftpProfile | null,
  /* 左栏：本地 */
  localPath: "",
  localEntries: [] as LocalEntry[],
  localSelected: null as LocalEntry | null,
  /* 拖拽中的远端路径 */
  dragPath: "",
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

/** 下载到指定本地目录（拖拽落点 / 当前本地目录） */
export async function downloadTo(remotePath: string, localDir: string) {
  if (!sftpStore.activeId || !remotePath || !localDir) return;
  sftpStore.busy = remotePath;
  sftpStore.error = "";
  try {
    const saved = await invoke<string>("sftp_download", {
      id: sftpStore.activeId,
      remotePath,
      localDir,
    });
    notify(`已下载：${saved}`);
    await loadLocal(sftpStore.localPath);
  } catch (err) {
    sftpStore.error = String(err);
    notify(String(err));
  } finally {
    sftpStore.busy = "";
  }
}

/** 拖到了没有具体目录的地方（比如「此电脑」列表）：弹一次目录选择 */
export async function downloadWithPicker(remotePath: string) {
  const picked = await open({ directory: true, title: "选择保存位置" });
  if (typeof picked === "string") await downloadTo(remotePath, picked);
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
