import { useEffect, useRef, useState } from "react";

interface CreatePatternModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}

/**
 * パターン新規作成モーダル
 * form submitを使用してIME変換確定と送信を区別
 */
export function CreatePatternModal({ isOpen, onClose, onCreate }: CreatePatternModalProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // モーダルが開いたらinputにフォーカス
  useEffect(() => {
    if (isOpen) {
      setName("");
      // 少し遅延させてフォーカス（アニメーション対応）
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Escキーでモーダルを閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onCreate(name.trim());
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-80" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="p-4 border-b border-gray-200">
          <h2 id="modal-title" className="font-semibold text-gray-800">
            新規パターン作成
          </h2>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="p-4">
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
              placeholder="パターン名を入力"
            />
          </div>
          <div className="p-4 border-t border-gray-200 flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded hover:bg-gray-200 cursor-pointer"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-2 text-sm text-white bg-blue-500 rounded hover:bg-blue-600 disabled:bg-gray-300 cursor-pointer disabled:cursor-not-allowed"
            >
              作成
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
