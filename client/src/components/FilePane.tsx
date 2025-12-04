import { useEffect, useMemo, useState } from "react";
import type { FileInfo } from "../types";

interface FilePaneProps {
  files: FileInfo[];
  selectedFile: string | null;
  onSelect: (filename: string) => void;
  onUpload: (file: File) => void;
  onDownload: (filename: string) => void;
}

const methodColors: Record<string, string> = {
  GET: "bg-green-100 text-green-700",
  POST: "bg-blue-100 text-blue-700",
  PUT: "bg-orange-100 text-orange-700",
  PATCH: "bg-yellow-100 text-yellow-700",
  DELETE: "bg-red-100 text-red-700",
  OPTIONS: "bg-purple-100 text-purple-700",
  HEAD: "bg-gray-100 text-gray-700",
};

/**
 * 中央ペイン - ファイル一覧
 * 幅: 250px
 */
export function FilePane({ files, selectedFile, onSelect, onUpload, onDownload }: FilePaneProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // パターン変更時にアコーディオンをリセット
  // biome-ignore lint/correctness/useExhaustiveDependencies: filesが変わったらリセット
  useEffect(() => {
    setExpandedGroups(new Set());
  }, [files]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
      e.target.value = "";
    }
  };

  // ファイルをエンドポイント別にグルーピング
  const groupedFiles = useMemo(() => {
    const groups: Map<string, FileInfo[]> = new Map();

    for (const file of files) {
      const key = file.endpoint;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)?.push(file);
    }

    return Array.from(groups.entries())
      .map(([endpoint, groupFiles]) => ({ endpoint, files: groupFiles }))
      .sort((a, b) => a.endpoint.localeCompare(b.endpoint));
  }, [files]);

  // 検索フィルタ
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedFiles;

    const query = searchQuery.toLowerCase();
    return groupedFiles
      .map((group) => ({
        ...group,
        files: group.files.filter(
          (f) => f.filename.toLowerCase().includes(query) || f.endpoint.toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.files.length > 0);
  }, [groupedFiles, searchQuery]);

  const toggleGroup = (endpoint: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(endpoint)) {
        next.delete(endpoint);
      } else {
        next.add(endpoint);
      }
      return next;
    });
  };

  return (
    <div className="w-[250px] bg-white border-r border-gray-300 flex flex-col shrink-0">
      {/* ヘッダー */}
      <div className="p-2 border-b border-gray-300 bg-gray-50">
        <span className="font-semibold text-sm text-gray-700">ファイル ({files.length})</span>
      </div>

      {/* 検索 */}
      <div className="p-2 border-b border-gray-200">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="検索..."
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* ファイルリスト */}
      <div className="flex-1 overflow-y-auto">
        {filteredGroups.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 text-center">
            {files.length === 0 ? "ファイルがありません" : "該当なし"}
          </div>
        ) : (
          filteredGroups.map((group) => (
            <div key={group.endpoint}>
              {/* グループヘッダー */}
              <button
                type="button"
                onClick={() => toggleGroup(group.endpoint)}
                className="w-full px-2 py-1.5 bg-gray-100 border-b border-gray-200 flex items-center gap-1 hover:bg-gray-200 text-left cursor-pointer"
              >
                <span className="text-xs text-gray-500">{expandedGroups.has(group.endpoint) ? "▼" : "▶"}</span>
                <span className="text-xs text-gray-700 truncate flex-1" title={group.endpoint}>
                  {group.endpoint}
                </span>
                <span className="text-xs text-gray-500">({group.files.length})</span>
              </button>

              {/* グループ内ファイル */}
              {expandedGroups.has(group.endpoint) &&
                group.files.map((file) => (
                  <button
                    key={file.filename}
                    type="button"
                    onClick={() => onSelect(file.filename)}
                    className={`w-full p-2 pl-4 border-b border-gray-100 text-left cursor-pointer ${
                      selectedFile === file.filename ? "bg-blue-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 text-xs font-mono rounded ${
                          methodColors[file.method] || "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {file.method}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDownload(file.filename);
                        }}
                        className="ml-auto p-1 text-gray-400 hover:text-blue-500 cursor-pointer"
                        title="ダウンロード"
                      >
                        ⬇
                      </button>
                    </div>
                    <div className="text-xs text-gray-500 mt-1 truncate" title={file.filename}>
                      {file.filename}
                    </div>
                  </button>
                ))}
            </div>
          ))
        )}
      </div>

      {/* アップロードボタン */}
      <div className="p-2 border-t border-gray-300">
        <label className="block text-xs bg-blue-500 text-white px-2 py-1.5 rounded hover:bg-blue-600 text-center cursor-pointer font-medium">
          + アップロード
          <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
        </label>
      </div>
    </div>
  );
}
