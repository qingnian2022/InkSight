#!/usr/bin/env node
/**
 * 一条命令构建 + （可选）发布，省去每次手动导出签名私钥环境变量。
 *
 * 用法：
 *   npm run release                     # 只构建（自动注入签名私钥）
 *   npm run release -- --publish        # 构建 + 发布到 Gitee Release
 *   npm run release -- --publish --notes "更新内容"
 *
 * 私钥查找顺序：
 *   1. 环境变量 TAURI_SIGNING_PRIVATE_KEY（路径或密钥文本都可以）
 *   2. ~/.tauri/jianzirumian.key
 *
 * 换设备时只要把私钥放到 ~/.tauri/jianzirumian.key 即可（见 docs/升级功能说明.md）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("用法：npm run release [-- --publish] [--notes \"更新说明\"]");
  process.exit(0);
}
const publish = args.includes("--publish");
const passthrough = args.filter((a) => a !== "--publish");

function resolveKey() {
  const fromEnv = process.env.TAURI_SIGNING_PRIVATE_KEY;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  // 环境变量里直接是密钥文本（不以路径形态存在时）也放行
  const candidate = path.join(os.homedir(), ".tauri", "jianzirumian.key");
  if (fs.existsSync(candidate)) return candidate;
  return fromEnv || "";
}

const key = resolveKey();
if (!key) {
  console.error(
    [
      "找不到签名私钥。任选一种：",
      "  1) 放到 ~/.tauri/jianzirumian.key",
      "  2) 设置环境变量 TAURI_SIGNING_PRIVATE_KEY（路径或密钥文本）",
      "私钥从密码管理器取，不要提交到仓库。",
    ].join("\n"),
  );
  process.exit(1);
}

function run(cmd, cmdArgs, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, ...env },
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}`))));
    child.on("error", reject);
  });
}

const isPath = fs.existsSync(key);
console.log(`签名私钥：${isPath ? key : "(来自环境变量的密钥文本)"}`);

try {
  console.log("\n构建中（带 updater 签名）…");
  await run("npx", ["tauri", "build"], { TAURI_SIGNING_PRIVATE_KEY: key });

  if (publish) {
    console.log("\n发布到 Gitee…");
    await run(process.execPath, [path.join(root, "scripts/publish-gitee.mjs"), ...passthrough]);
  } else {
    console.log("\n构建完成。加 --publish 可一并发布到 Gitee Release。");
  }
} catch (err) {
  console.error(`\n失败：${err.message}`);
  process.exit(1);
}
