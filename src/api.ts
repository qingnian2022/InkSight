import { invoke } from "@tauri-apps/api/core";
import type { FsNode } from "./types";

export const scanVault = (root: string) => invoke<FsNode[]>("vault_scan", { root });

export const readDoc = (path: string) => invoke<string>("doc_read", { path });

export const writeDoc = (path: string, content: string) =>
  invoke<void>("doc_write", { path, content });

export const createDoc = (dir: string, name: string) =>
  invoke<string>("doc_create", { dir, name });

export const createDir = (dir: string, name: string) =>
  invoke<string>("dir_create", { dir, name });

export const copyNode = (path: string) => invoke<string>("node_copy", { path });

export const renameNode = (path: string, newName: string) =>
  invoke<string>("node_rename", { path, newName });

export const trashNode = (root: string, path: string) =>
  invoke<void>("node_trash", { root, path });

export const importAsset = (vault: string, docPath: string, src: string) =>
  invoke<string>("asset_import", { vault, docPath, src });

export interface DataDirInfo {
  path: string;
  fallback: boolean;
}

export interface RenamedEntry {
  from: string;
  to: string;
}

export interface ImportReport {
  imported: number;
  renamed: RenamedEntry[];
}

export interface ExportReport {
  files: number;
  bytes: number;
}

/** 解析内置数据目录（<exe 目录>/data，不可写时降级 AppData）。 */
export const dataDir = () => invoke<DataDirInfo>("data_dir");

/** 在资源管理器中打开数据目录。 */
export const openDataDir = (path: string) => invoke<void>("open_data_dir", { path });

/** 把 Markdown 文件批量复制进目标目录，重名自动加序号。 */
export const importDocs = (destDir: string, sources: string[]) =>
  invoke<ImportReport>("import_docs", { destDir, sources });

/** 导出为 zip：entries 为空打包整库，否则只打包列出的文件 / 文件夹。 */
export const exportZip = (sourceRoot: string, destFile: string, entries: string[] | null) =>
  invoke<ExportReport>("export_zip", { sourceRoot, destFile, entries });

export function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function dirName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 2] || path;
}

export function stripExt(name: string): string {
  return name.replace(/\.mdx?$/i, "");
}

export function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}
