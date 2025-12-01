import { useCallback, useMemo, useState } from "react";
import type { FileInfo } from "../api/client";
import type { TreeNode } from "../components/sidebar/types";

function normalizePath(path: string): string {
  return path
    .split("/")
    .map((segment) => (/^\d+$/.test(segment) ? "{id}" : segment))
    .join("/");
}

function buildTree(files: FileInfo[]): TreeNode[] {
  const root: TreeNode = {
    segment: "",
    fullPath: "",
    children: [],
    endpoints: [],
  };

  for (const file of files) {
    const normalizedPath = normalizePath(file.path);
    const segments = normalizedPath.split("/").filter(Boolean);

    let current = root;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const fullPath = `/${segments.slice(0, i + 1).join("/")}`;

      let child = current.children.find((c) => c.segment === segment);
      if (!child) {
        child = {
          segment,
          fullPath,
          children: [],
          endpoints: [],
        };
        current.children.push(child);
      }
      current = child;
    }

    current.endpoints.push({
      method: file.method,
      status: file.status,
      size: file.size,
      originalPath: file.path,
    });
  }

  return root.children;
}

function countEndpoints(node: TreeNode): number {
  let count = node.endpoints.length;
  for (const child of node.children) {
    count += countEndpoints(child);
  }
  return count;
}

function collectAllPaths(nodes: TreeNode[]): Set<string> {
  const paths = new Set<string>();
  const traverse = (node: TreeNode) => {
    if (node.children.length > 0) {
      paths.add(node.fullPath);
    }
    for (const child of node.children) {
      traverse(child);
    }
  };
  for (const node of nodes) {
    traverse(node);
  }
  return paths;
}

export function useEndpointTree(files: FileInfo[]) {
  const tree = useMemo(() => buildTree(files), [files]);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const node of tree) {
      initial.add(node.fullPath);
    }
    return initial;
  });

  const togglePath = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedPaths(collectAllPaths(tree));
  }, [tree]);

  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set());
  }, []);

  return {
    tree,
    expandedPaths,
    togglePath,
    expandAll,
    collapseAll,
    countEndpoints,
  };
}
