#!/usr/bin/env node
/**
 * 生成 updater 用的 updates/latest.json。
 *
 * 用法（先 normal 构建带签名的安装包）：
 *   set TAURI_SIGNING_PRIVATE_KEY=%USERPROFILE%\.tauri\jianzirumian.key
 *   npm run tauri build
 *   node scripts/make-update-json.mjs --url-base https://gitee.com/<用户>/<仓库>/releases/download/v0.3.0
 *
 * 产出：updates/latest.json（把这个文件和 setup.exe 一起传到 Gitee Release，
 * 再把 latest.json 提交到仓库的 master 分支 —— endpoints 指向 raw 地址时才能读到最新版本）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const conf = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
const version = conf.version;

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const nsisDir = path.join(root, "src-tauri/target/release/bundle/nsis");
if (!fs.existsSync(nsisDir)) {
  console.error(`找不到打包目录：${nsisDir}\n请先执行 npm run tauri build`);
  process.exit(1);
}

const files = fs.readdirSync(nsisDir);
const exe = files.find((f) => f.endsWith("-setup.exe"));
const sigFile = files.find((f) => f.endsWith("-setup.exe.sig"));
if (!exe || !sigFile) {
  console.error("没找到 setup.exe 或其 .sig 文件。确认 tauri.conf.json 里 bundle.createUpdaterArtifacts = true，且构建时设置了 TAURI_SIGNING_PRIVATE_KEY。");
  process.exit(1);
}

const signature = fs.readFileSync(path.join(nsisDir, sigFile), "utf8").trim();
const urlBase = (argOf("url-base") || "").replace(/\/+$/, "");
const notes = argOf("notes") || `发布 v${version}`;

if (!urlBase) {
  console.warn("提示：未传 --url-base，下载地址会写成占位符，需要手动改。");
}

const payload = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: urlBase ? `${urlBase}/${encodeURIComponent(exe)}` : `https://example.com/${encodeURIComponent(exe)}`,
    },
  },
};

const outDir = path.join(root, "updates");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "latest.json"), `${JSON.stringify(payload, null, 2)}\n`);

console.log(`已生成 ${path.join("updates", "latest.json")}`);
console.log(`  版本：${version}`);
console.log(`  安装包：${exe}`);
console.log(`  下载地址：${payload.platforms["windows-x86_64"].url}`);
console.log("\n下一步：把 latest.json 与安装包上传到 Gitee Release，并把 latest.json 提交到默认分支（endpoints 指向 raw 地址）。");
