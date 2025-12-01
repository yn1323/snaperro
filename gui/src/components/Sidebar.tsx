import type { FileInfo } from "../api/client";
import { EndpointTree } from "./sidebar/EndpointTree";
import { PatternSection } from "./sidebar/PatternSection";

interface SidebarProps {
  pattern: string;
  patterns: string[];
  files: FileInfo[];
  selectedFile: string | null;
  onPatternSelect: (pattern: string) => void;
  onFileSelect: (filePath: string) => void;
  onCreatePattern: (name: string) => void;
  width: number;
}

export function Sidebar({
  pattern,
  patterns,
  files,
  selectedFile,
  onPatternSelect,
  onFileSelect,
  onCreatePattern,
  width,
}: SidebarProps) {
  return (
    <aside className="bg-bg-secondary overflow-y-auto flex flex-col shrink-0" style={{ width: `${width}px` }}>
      <div className="p-3 border-b border-border">
        <PatternSection
          patterns={patterns}
          selectedPattern={pattern}
          onSelect={onPatternSelect}
          onCreate={onCreatePattern}
        />
      </div>

      {pattern && (
        <div className="p-3 flex-1 overflow-y-auto">
          <EndpointTree files={files} selectedFile={selectedFile} onFileSelect={onFileSelect} pattern={pattern} />
        </div>
      )}
    </aside>
  );
}
