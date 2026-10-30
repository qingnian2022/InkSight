/**
 * 同步服务器（Rust 端 `server/`）的 HTTP 客户端。
 * 只做协议转换，不碰本地文件；落盘与冲突处理在 store 里完成。
 */

export interface RemoteNote {
  path: string;
  content: string;
  version: number;
  updatedAt: number;
  /** 墓碑：该路径在服务端已被删除 */
  deleted?: boolean;
}

export interface PullResult {
  cursor: number;
  notes: RemoteNote[];
}

export interface PutResult {
  ok: boolean;
  version: number;
  /** 409 时返回服务端当前内容 */
  content?: string;
}

export class ServerAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerAuthError";
  }
}

function base(url: string): string {
  return url.replace(/\/+$/, "");
}

function headers(token: string): HeadersInit {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text };
  }
}

export async function serverPull(url: string, token: string, cursor: number): Promise<PullResult> {
  const res = await fetch(`${base(url)}/sync?since=${cursor}`, { headers: headers(token) });
  const body = await readJson(res);
  if (res.status === 401) throw new ServerAuthError(body?.message || "登录已失效");
  if (!res.ok) throw new Error(body?.message || `服务器返回 ${res.status}`);
  return {
    cursor: Number(body.cursor ?? cursor),
    notes: Array.isArray(body.notes) ? body.notes : [],
  };
}

export async function serverPut(
  url: string,
  token: string,
  note: { path: string; content: string; baseVersion: number },
): Promise<PutResult> {
  const res = await fetch(`${base(url)}/notes`, {
    method: "PUT",
    headers: headers(token),
    body: JSON.stringify(note),
  });
  const body = await readJson(res);
  if (res.status === 401) throw new ServerAuthError(body?.message || "登录已失效");
  if (res.status === 409) {
    return { ok: false, version: Number(body.version ?? 0), content: body.content ?? "" };
  }
  if (!res.ok) throw new Error(body?.message || `服务器返回 ${res.status}`);
  return { ok: true, version: Number(body.version ?? note.baseVersion + 1) };
}

/** 简单内容指纹：只用来判断「本地是否被改过」，不需要密码学强度 */
export function fingerprint(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}


export interface AuthProfile {
  token: string;
  email: string;
  username: string;
  avatar: string;
}

async function authRequest(url: string, path: "/auth/register" | "/auth/login", payload: unknown): Promise<AuthProfile> {
  const res = await fetch(`${base(url)}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(body?.message || `服务器返回 ${res.status}`);
  return {
    token: String(body.token ?? ""),
    email: String(body.email ?? ""),
    username: String(body.username ?? ""),
    avatar: String(body.avatar ?? ""),
  };
}

export const serverRegister = (
  url: string,
  payload: { email: string; password: string; username: string; avatar: string },
) => authRequest(url, "/auth/register", payload);

export const serverLogin = (url: string, email: string, password: string) =>
  authRequest(url, "/auth/login", { email, password });

export async function serverLogout(url: string, token: string): Promise<void> {
  try {
    await fetch(`${base(url)}/auth/logout`, { method: "POST", headers: headers(token) });
  } catch {
    /* 服务端不可达也要清掉本地会话 */
  }
}


export async function serverUpdateProfile(
  url: string,
  token: string,
  payload: { username: string; avatar: string },
): Promise<Omit<AuthProfile, "token">> {
  const res = await fetch(`${base(url)}/auth/profile`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify(payload),
  });
  const body = await readJson(res);
  if (res.status === 401) throw new ServerAuthError(body?.message || "登录已失效");
  if (!res.ok) throw new Error(body?.message || `服务器返回 ${res.status}`);
  return {
    email: String(body.email ?? ""),
    username: String(body.username ?? ""),
    avatar: String(body.avatar ?? ""),
  };
}


/** 删除 = 服务端写墓碑，其他设备拉取后把本地文件移到回收站 */
export async function serverDelete(url: string, token: string, path: string): Promise<number> {
  const res = await fetch(`${base(url)}/notes?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
    headers: headers(token),
  });
  const body = await readJson(res);
  if (res.status === 401) throw new ServerAuthError(body?.message || "登录已失效");
  // 旧服务端尚未实现 DELETE 时不阻断同步，只是这次删除传不上去
  if (res.status === 404 || res.status === 405) return 0;
  if (!res.ok) throw new Error(body?.message || `服务器返回 ${res.status}`);
  return Number(body.version ?? 0);
}
