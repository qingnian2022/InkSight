export interface FsNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FsNode[] | null;
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
