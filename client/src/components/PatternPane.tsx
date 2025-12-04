import { useState } from "react";
import { CreatePatternModal } from "./CreatePatternModal";

interface PatternPaneProps {
  patterns: string[];
  currentPattern: string | null;
  onSelect: (pattern: string) => void;
  onCreate: (name: string) => void;
  onUpload: (file: File) => void;
}

/**
 * 左ペイン - パターン一覧
 * 幅: 150px固定
 */
export function PatternPane({ patterns, currentPattern, onSelect, onCreate, onUpload }: PatternPaneProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
      e.target.value = "";
    }
  };

  return (
    <div className="w-[150px] bg-gray-100 border-r border-gray-300 flex flex-col shrink-0">
      {/* ヘッダー */}
      <div className="p-2 border-b border-gray-300 bg-gray-200">
        <span className="font-semibold text-sm text-gray-700">パターン</span>
      </div>

      {/* パターンリスト */}
      <div className="flex-1 overflow-y-auto">
        {patterns.length === 0 ? (
          <div className="p-3 text-xs text-gray-500 text-center">パターンがありません</div>
        ) : (
          patterns.map((pattern) => (
            <button
              key={pattern}
              type="button"
              className={`w-full px-2 py-1.5 text-left text-sm truncate ${
                currentPattern === pattern
                  ? "bg-blue-100 border-l-2 border-blue-500 text-blue-800"
                  : "hover:bg-gray-200 text-gray-700"
              }`}
              onClick={() => onSelect(pattern)}
              title={pattern}
            >
              {pattern}
            </button>
          ))
        )}
      </div>

      {/* アクションボタン */}
      <div className="p-2 border-t border-gray-300 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="text-xs bg-blue-500 text-white px-2 py-1.5 rounded hover:bg-blue-600 font-medium"
        >
          + 新規作成
        </button>
        <label className="text-xs bg-gray-500 text-white px-2 py-1.5 rounded hover:bg-gray-600 text-center cursor-pointer font-medium">
          ZIP取込
          <input type="file" accept=".zip" onChange={handleFileUpload} className="hidden" />
        </label>
      </div>

      {/* パターン作成モーダル */}
      <CreatePatternModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onCreate={onCreate} />
    </div>
  );
}
