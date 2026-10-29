#!/usr/bin/env node
/**
 * 把版本号同步到所有声明位置（本地或 CI 都可用）。
 *
 *   node scripts/bump-version.mjs 1.2.0
 *   node scripts/bump-version.mjs --from-tag v1.2.0
 *
 * 覆盖：package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml /
 *      src-tauri/Cargo.lock（本包条目）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const raw = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? process.argv.at(-1) ?? "";
const version = String(raw).replace(/^v/, "").trim();

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`版本号不合法：${raw || "(空)"}；期望 v1.2.3 或 1.2.3`);
  process.exit(1);
}

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const write = (file, text) => fs.writeFileSync(path.join(root, file), text);

let changed = 0;
function report(file, same) {
  if (!same) changed += 1;
  console.log(`${same ? "=" : "✓"} ${file}${same ? "" : ` → ${version}`}`);
}

{
  const file = "package.json";
  const text = read(file);
  const pkg = JSON.parse(text);
  const same = pkg.version === version;
  if (!same) {
    pkg.version = version;
    write(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  report(file, same);
}

{
  const file = "src-tauri/tauri.conf.json";
  const text = read(file);
  const conf = JSON.parse(text);
  const same = conf.version === version;
  if (!same) {
    conf.version = version;
    write(file, `${JSON.stringify(conf, null, 2)}\n`);
  }
  report(file, same);
}

{
  const file = "src-tauri/Cargo.toml";
  const text = read(file);
  const next = text.replace(/^version = "[^"]*"$/m, `version = "${version}"`);
  if (next !== text) write(file, next);
  report(file, next === text);
}

{
  const file = "src-tauri/Cargo.lock";
  if (fs.existsSync(path.join(root, file))) {
    const text = read(file);
    const next = text.replace(
      /(name = "md-rust"\r?\nversion = ")[^"]*(")/,
      `$1${version}$2`,
    );
    if (next !== text) write(file, next);
    report(file, next === text);
  }
}

console.log(changed ? `\n已更新 ${changed} 个文件` : "\n版本号已是最新");
