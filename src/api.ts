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
