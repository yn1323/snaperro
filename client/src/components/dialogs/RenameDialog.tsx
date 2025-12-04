import { useEffect, useRef, useState } from "react";

interface RenameDialogProps {
  isOpen: boolean;
  currentName: string;
  onClose: () => void;
  onSubmit: (newName: string) => void;
}

/**
 * リネームダイアログ
 */
export function RenameDialog({ isOpen, currentName, onClose, onSubmit }: RenameDialogProps) {
  const [name, setName] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  // モーダルが開いたらinputにフォーカスして全選択
  useEffect(() => {
    if (isOpen) {
      setName(currentName);
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, currentName]);

  // Escキーでダイアログを閉じる
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
    const trimmed = name.trim();
    if (trimmed && trimmed !== currentName) {
      onSubmit(trimmed);
      onClose();
    }
  };

  if (!isOpen) return null;

  const isValid = name.trim() && name.trim() !== currentName;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        className="bg-white rounded-lg shadow-xl w-80"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-title"
      >
        <div className="p-4 border-b border-gray-200">
          <h2 id="rename-title" className="font-semibold text-gray-800">
            パターン名変更
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
              placeholder="新しいパターン名を入力"
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
              disabled={!isValid}
              className="px-4 py-2 text-sm text-white bg-blue-500 rounded hover:bg-blue-600 disabled:bg-gray-300 cursor-pointer disabled:cursor-not-allowed"
            >
              変更
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
