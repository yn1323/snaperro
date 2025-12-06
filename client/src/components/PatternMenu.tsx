import { useEffect, useRef, useState } from "react";

interface PatternMenuProps {
  patternName: string;
  onRename: () => void;
  onDuplicate: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

/**
 * Pattern action menu (⋮ dropdown)
 */
export function PatternMenu({ patternName, onRename, onDuplicate, onDownload, onDelete }: PatternMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Close menu with Esc key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const handleAction = (action: () => void) => {
    setIsOpen(false);
    action();
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded cursor-pointer"
        title={`Menu for ${patternName}`}
      >
        ⋮
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg z-50 min-w-[140px]">
          <button
            type="button"
            onClick={() => handleAction(onRename)}
            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 cursor-pointer"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => handleAction(onDuplicate)}
            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 cursor-pointer"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => handleAction(onDownload)}
            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 cursor-pointer"
          >
            Download ZIP
          </button>
          <div className="border-t border-gray-200" />
          <button
            type="button"
            onClick={() => handleAction(onDelete)}
            className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 cursor-pointer"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
