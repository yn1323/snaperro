import type { FileInfo } from "../../api/client";
import { useEndpointTree } from "../../hooks/useEndpointTree";
import { TreeNode } from "./TreeNode";

interface EndpointTreeProps {
  files: FileInfo[];
  selectedFile: string | null;
  onFileSelect: (filePath: string) => void;
  pattern: string;
}

export function EndpointTree({ files, selectedFile, onFileSelect, pattern }: EndpointTreeProps) {
  const { tree, expandedPaths, togglePath, countEndpoints } = useEndpointTree(files);

  if (files.length === 0) {
    return <p className="text-text-secondary text-sm text-center py-4">ファイルがありません</p>;
  }

  return (
    <div className="endpoint-tree">
      <h3 className="text-[11px] uppercase text-text-secondary mb-2 tracking-wider font-medium">
        Endpoints in "{pattern}"
      </h3>
      <div className="space-y-0.5">
        {tree.map((node) => (
          <TreeNode
            key={node.fullPath}
            node={node}
            depth={0}
            selectedFile={selectedFile}
            onFileSelect={onFileSelect}
            expandedPaths={expandedPaths}
            onToggle={togglePath}
            countEndpoints={countEndpoints}
          />
        ))}
      </div>
    </div>
  );
}
