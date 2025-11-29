import { useEffect, useRef, useState } from "react";
import type { FileInfo } from "../api/client";
import styles from "./Sidebar.module.css";

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

  const getStatusColor = (status: number): string => {
    if (status >= 200 && status < 300) return "var(--success)";
    if (status >= 400 && status < 500) return "var(--warning)";
    if (status >= 500) return "var(--error)";
    return "var(--text-secondary)";
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Patterns</h3>
        <ul className={styles.patternList}>
          {patterns.map((p) => (
            <li key={p}>
              <button
                type="button"
                className={`${styles.patternItem} ${p === pattern ? styles.active : ""}`}
                onClick={() => onPatternSelect(p)}
              >
                <span className={styles.folderIcon}>📁</span>
                {p}
              </button>
            </li>
          ))}
        </ul>
        {showInput ? (
          <div className={styles.inputGroup}>
            <input
              ref={inputRef}
              type="text"
              value={newPatternName}
              onChange={(e) => setNewPatternName(e.target.value)}
              placeholder="パターン名"
              className={styles.input}
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
          <button type="button" className={`${styles.addBtn} btn-secondary`} onClick={() => setShowInput(true)}>
            + 新規パターン
          </button>
        )}
      </div>

      {pattern && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Files in "{pattern}"</h3>
          {files.length === 0 ? (
            <p className={styles.empty}>ファイルがありません</p>
          ) : (
            <ul className={styles.fileList}>
              {files.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    className={`${styles.fileItem} ${selectedFile === f.path ? styles.active : ""}`}
                    onClick={() => onFileSelect(f.path)}
                  >
                    <div className={styles.fileInfo}>
                      <span className={styles.method}>{f.method}</span>
                      <span className={styles.path}>{f.path}</span>
                    </div>
                    <div className={styles.fileMeta}>
                      <span className={styles.status} style={{ color: getStatusColor(f.status) }}>
                        {f.status}
                      </span>
                      <span className={styles.size}>{formatSize(f.size)}</span>
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
