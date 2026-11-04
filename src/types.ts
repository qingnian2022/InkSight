export interface FsNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FsNode[] | null;
  /** 虚拟节点（如「置顶」文件夹）：不做右键文件操作、不可折叠 */
  isVirtual?: boolean;
}

export interface Tab {
  path: string;
  name: string;
  content: string;
  dirty: boolean;
  /** 最近一次与磁盘一致的内容（用于区分「磁盘被外部改动」和「本地未保存编辑」） */
  base?: string;
  /** 用户选择「保留本地」时记录的磁盘内容，避免同一改动每次同步都弹冲突 */
  ignoreDisk?: string;
}

export interface OutlineItem {
  level: number;
  text: string;
  line: number;
}

export type SaveState = "saved" | "dirty" | "saving" | "error";

export type BlockType =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "quote"
  | "code"
  | "bullet"
  | "ordered";
