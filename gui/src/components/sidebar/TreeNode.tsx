import { EndpointItem } from "./EndpointItem";
import type { TreeNode as TreeNodeType } from "./types";

interface TreeNodeProps {
  node: TreeNodeType;
  depth: number;
  selectedFile: string | null;
  onFileSelect: (filePath: string) => void;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  countEndpoints: (node: TreeNodeType) => number;
}

export function TreeNode({
  node,
  depth,
  selectedFile,
  onFileSelect,
  expandedPaths,
  onToggle,
  countEndpoints,
}: TreeNodeProps) {
  const hasChildren = node.children.length > 0 || node.endpoints.length > 0;
  const isExpandable = node.children.length > 0;
  // 子ノードがない場合（エンドポイントのみ）は常に展開状態
  const isExpanded = isExpandable ? expandedPaths.has(node.fullPath) : true;
  const endpointCount = countEndpoints(node);

  const nodeContent = (
    <>
      {isExpandable && (
        <span
          className={`text-[10px] text-text-secondary transition-transform duration-150 w-3 ${
            isExpanded ? "rotate-90" : ""
          }`}
        >
          ▶
        </span>
      )}
      {!isExpandable && <span className="w-3" />}
      <span className="text-[13px] text-text-primary font-medium">{node.segment}</span>
      {!isExpanded && endpointCount > 0 && (
        <span className="text-[10px] text-text-secondary ml-1">({endpointCount})</span>
      )}
    </>
  );

  return (
    <div className="tree-node">
      {isExpandable ? (
        <button
          type="button"
          className="flex items-center gap-1 py-0.5 rounded transition-colors duration-150 cursor-pointer hover:bg-bg-tertiary/50 w-full text-left"
          style={{ paddingLeft: `${depth * 12}px` }}
          onClick={() => onToggle(node.fullPath)}
        >
          {nodeContent}
        </button>
      ) : (
        <div
          className="flex items-center gap-1 py-0.5 rounded transition-colors duration-150"
          style={{ paddingLeft: `${depth * 12}px` }}
        >
          {nodeContent}
        </div>
      )}

      {hasChildren && (
        <div
          className={`tree-children overflow-hidden transition-all duration-200 ease-out ${
            isExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="relative" style={{ marginLeft: `${depth * 12 + 6}px` }}>
            <div className="absolute left-0 top-0 bottom-2 w-px bg-border" />
            <div className="pl-3">
              {node.endpoints.map((endpoint) => (
                <div key={`${endpoint.method}-${endpoint.originalPath}`} className="relative">
                  <div className="absolute left-[-12px] top-1/2 w-2 h-px bg-border" />
                  <EndpointItem
                    endpoint={endpoint}
                    isSelected={selectedFile === endpoint.originalPath}
                    onSelect={() => onFileSelect(endpoint.originalPath)}
                  />
                </div>
              ))}
              {node.children.map((child) => (
                <div key={child.fullPath} className="relative">
                  <div className="absolute left-[-12px] top-3 w-2 h-px bg-border" />
                  <TreeNode
                    node={child}
                    depth={0}
                    selectedFile={selectedFile}
                    onFileSelect={onFileSelect}
                    expandedPaths={expandedPaths}
                    onToggle={onToggle}
                    countEndpoints={countEndpoints}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
