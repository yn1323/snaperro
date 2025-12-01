import { useEffect, useRef, useState } from "react";
import type { FileInfo } from "../api/client";

interface SidebarProps {
  pattern: string;
  patterns: string[];
  files: FileInfo[];
  selectedFile: string | null;
  onPatternSelect: (pattern: string) => void;
  onFileSelect: (filePath: string) => void;
  onCreatePattern: (name: string) => void;
}

export function Sidebar({
  pattern,
  patterns,
  files,
  selectedFile,
  onPatternSelect,
  onFileSelect,
  onCreatePattern,
}: SidebarProps) {
  const [newPatternName, setNewPatternName] = useState("");
  const [showInput, setShowInput] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showInput]);

  const handleCreate = () => {
    if (newPatternName.trim()) {
      onCreatePattern(newPatternName.trim());
      setNewPatternName("");
      setShowInput(false);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const getStatusColorClass = (status: number): string => {
    if (status >= 200 && status < 300) return "text-success";
    if (status >= 400 && status < 500) return "text-warning";
    if (status >= 500) return "text-error";
    return "text-text-secondary";
  };

  const getMethodColorClass = (method: string): string => {
    switch (method.toUpperCase()) {
      case "GET":
        return "bg-method-get/20 text-method-get";
      case "POST":
        return "bg-method-post/20 text-method-post";
      case "PUT":
        return "bg-method-put/20 text-method-put";
      case "PATCH":
        return "bg-method-patch/20 text-method-patch";
      case "DELETE":
        return "bg-method-delete/20 text-method-delete";
      default:
        return "bg-bg-tertiary text-text-primary";
    }
  };

  return (
    <aside className="w-[300px] bg-bg-secondary border-r border-border overflow-y-auto flex flex-col">
      <div className="p-4 border-b border-border">
        <h3 className="text-xs uppercase text-text-secondary mb-3 tracking-wide">Patterns</h3>
        <ul className="list-none">
          {patterns.map((p) => (
            <li key={p}>
              <button
                type="button"
                className={`w-full px-3 py-2 rounded cursor-pointer transition-colors duration-200 flex items-center gap-2 text-left ${
                  p === pattern ? "bg-accent text-white" : "hover:bg-bg-tertiary"
                }`}
                onClick={() => onPatternSelect(p)}
              >
                <span className="text-base">📁</span>
                {p}
              </button>
            </li>
          ))}
        </ul>
        {showInput ? (
          <div className="flex gap-2 mt-2">
            <input
              ref={inputRef}
              type="text"
              value={newPatternName}
              onChange={(e) => setNewPatternName(e.target.value)}
              placeholder="パターン名"
              className="flex-1 min-w-0"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <button type="button" className="btn-primary" onClick={handleCreate}>
              作成
            </button>
            <button type="button" className="btn-secondary" onClick={() => setShowInput(false)}>
              ✕
            </button>
          </div>
        ) : (
          <button type="button" className="btn-secondary w-full mt-2" onClick={() => setShowInput(true)}>
            + 新規パターン
          </button>
        )}
      </div>

      {pattern && (
        <div className="p-4 border-b border-border">
          <h3 className="text-xs uppercase text-text-secondary mb-3 tracking-wide">Files in "{pattern}"</h3>
          {files.length === 0 ? (
            <p className="text-text-secondary text-sm text-center py-4">ファイルがありません</p>
          ) : (
            <ul className="list-none">
              {files.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    className={`w-full px-3 py-2 rounded cursor-pointer transition-colors duration-200 flex flex-col items-start gap-1 text-left ${
                      selectedFile === f.path ? "bg-accent text-white" : "hover:bg-bg-tertiary"
                    }`}
                    onClick={() => onFileSelect(f.path)}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-sm ${
                          selectedFile === f.path ? "bg-white/20 text-white" : getMethodColorClass(f.method)
                        }`}
                      >
                        {f.method}
                      </span>
                      <span className="text-[13px] overflow-hidden text-ellipsis whitespace-nowrap flex-1">
                        {f.path}
                      </span>
                    </div>
                    <div className="flex gap-3 text-xs">
                      <span
                        className={`font-semibold ${
                          selectedFile === f.path ? "text-white/80" : getStatusColorClass(f.status)
                        }`}
                      >
                        {f.status}
                      </span>
                      <span className={selectedFile === f.path ? "text-white/80" : "text-text-secondary"}>
                        {formatSize(f.size)}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
