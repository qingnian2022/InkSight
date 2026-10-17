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
