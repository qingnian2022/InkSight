#!/usr/bin/env node
/**
 * 一键发布到 Gitee Release（本地执行，等价于「自动构建」的最后一步）。
 *
 * 前置：
 *   1. src-tauri/tauri.conf.json 的 plugins.updater.endpoints 填的是真实仓库
 *      https://gitee.com/<owner>/<repo>/raw/master/updates/latest.json
 *   2. 环境变量 GITEE_TOKEN（Gitee 私人令牌，勾选 projects + releases 权限）
 *   3. 已经跑过带签名的构建：
 *        $env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\jianzirumian.key"
 *        npm run tauri build
 *
 * 用法：
 *   node scripts/publish-gitee.mjs --notes "本次更新内容"
 *   node scripts/publish-gitee.mjs --dry-run        # 只生成 latest.json，不调 API
 *
 * 做的事：生成 latest.json → 创建 Release → 上传 setup.exe → 更新仓库里的
 * updates/latest.json（客户端检查更新的入口文件）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const API = "https://gitee.com/api/v5";
const root = path.resolve(import.meta.dirname, "..");
const confPath = path.join(root, "src-tauri/tauri.conf.json");
const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
const version = conf.version;
const tag = `v${version}`;

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const notes = argOf("notes") || `发布 ${tag}`;

/** 从 updater endpoint 里解析 owner/repo：https://gitee.com/<owner>/<repo>/raw/... */
function parseRepo() {
  const endpoint = conf.plugins?.updater?.endpoints?.[0] ?? "";
  const m = endpoint.match(/gitee\.com\/([^/]+)\/([^/]+)\//);
  if (!m || m[1] === "OWNER" || m[2] === "REPO") {
    console.error(
      `请先在 src-tauri/tauri.conf.json 把 endpoints 里的 OWNER/REPO 换成真实仓库。\n当前：${endpoint || "(空)"}`,
    );
    process.exit(1);
  }
  return { owner: m[1], repo: m[2] };
}

/** 收集 nsis 产物（setup.exe + .sig） */
function collectArtifacts() {
  const dir = path.join(root, "src-tauri/target/release/bundle/nsis");
  if (!fs.existsSync(dir)) {
    console.error(`找不到打包目录：${dir}\n请先执行 npm run tauri build`);
    process.exit(1);
  }
  const files = fs.readdirSync(dir);
  const exe = files.find((f) => f.endsWith("-setup.exe"));
  const sig = files.find((f) => f.endsWith("-setup.exe.sig"));
  if (!exe || !sig) {
    console.error("缺少 setup.exe 或其 .sig。确认 bundle.createUpdaterArtifacts=true，且构建时设置了签名私钥。");
    process.exit(1);
  }
  return {
    exePath: path.join(dir, exe),
    exeName: exe,
    signature: fs.readFileSync(path.join(dir, sig), "utf8").trim(),
  };
}

async function api(pathname, init = {}) {
  const token = process.env.GITEE_TOKEN;
  if (!token) {
    console.error("缺少环境变量 GITEE_TOKEN（Gitee → 设置 → 私人令牌，勾选 projects / releases）");
    process.exit(1);
  }
  const url = `${API}${pathname}${pathname.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${pathname} → ${res.status}\n${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** 更新仓库里的 updates/latest.json（没有就创建） */
async function upsertLatestJson(owner, repo, payload) {
  const apiPath = `/repos/${owner}/${repo}/contents/updates/latest.json`;
  const content = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`).toString("base64");

  let sha;
  try {
    const existing = await api(`${apiPath}?ref=master`);
    sha = existing?.sha;
  } catch {
    sha = undefined;
  }

  await api(apiPath, {
    method: sha ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      message: `chore(release): ${tag} latest.json`,
      branch: "master",
      ...(sha ? { sha } : {}),
    }),
  });
}

async function main() {
  const { owner, repo } = parseRepo();
  const { exePath, exeName, signature } = collectArtifacts();
  const downloadUrl = `https://gitee.com/${owner}/${repo}/releases/download/${tag}/${encodeURIComponent(exeName)}`;

  const payload = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: { "windows-x86_64": { signature, url: downloadUrl } },
  };

  const outPath = path.join(root, "updates/latest.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`已生成 updates/latest.json（${tag}）`);
  console.log(`  安装包：${exeName}`);
  console.log(`  下载地址：${downloadUrl}`);

  if (dryRun) {
    console.log("\n--dry-run：跳过 API 调用与 Release 创建。");
    return;
  }

  console.log("\n创建 Release…");
  let release;
  try {
    release = await api(`/repos/${owner}/${repo}/releases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag_name: tag, name: tag, body: notes, target_commitish: "master", prerelease: false }),
    });
  } catch (err) {
    // 已存在同名 tag/Release：查询出来复用
    release = await api(`/repos/${owner}/${repo}/releases/tags/${tag}`).catch(() => null);
    if (!release) throw err;
    console.log(`Release ${tag} 已存在，复用 id=${release.id}`);
  }
  console.log(`Release id=${release.id}`);

  console.log("上传安装包…");
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(exePath)]), exeName);
  await api(`/repos/${owner}/${repo}/releases/${release.id}/attach_files`, { method: "POST", body: form });
  console.log("上传完成");

  console.log("更新仓库里的 updates/latest.json…");
  await upsertLatestJson(owner, repo, payload);
  console.log("完成。客户端点「检查更新」即可看到新版本。");
}

main().catch((err) => {
  console.error(`发布失败：${err.message}`);
  process.exit(1);
});
