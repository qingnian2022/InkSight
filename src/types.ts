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
