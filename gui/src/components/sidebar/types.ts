import type { FileInfo } from "../../api/client";

export interface EndpointInfo {
  method: string;
  status: number;
  size: number;
  originalPath: string;
}

export interface TreeNode {
  segment: string;
  fullPath: string;
  children: TreeNode[];
  endpoints: EndpointInfo[];
}

export interface SidebarProps {
  pattern: string;
  patterns: string[];
  files: FileInfo[];
  selectedFile: string | null;
  onPatternSelect: (pattern: string) => void;
  onFileSelect: (filePath: string) => void;
  onCreatePattern: (name: string) => void;
}
