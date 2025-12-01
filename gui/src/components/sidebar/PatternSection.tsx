import { useEffect, useRef, useState } from "react";

interface PatternSectionProps {
  patterns: string[];
  selectedPattern: string;
  onSelect: (pattern: string) => void;
  onCreate: (name: string) => void;
}

export function PatternSection({ patterns, selectedPattern, onSelect, onCreate }: PatternSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
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
      onCreate(newPatternName.trim());
      setNewPatternName("");
      setShowInput(false);
    }
  };

  return (
    <div className="pattern-section">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 py-2 px-0 text-left hover:bg-transparent"
      >
        <span
          className={`text-[10px] text-text-secondary transition-transform duration-150 ${
            isExpanded ? "rotate-90" : ""
          }`}
        >
          ▶
        </span>
        <span className="text-[11px] uppercase text-text-secondary tracking-wider font-medium">Patterns</span>
      </button>

      <div
        className={`overflow-hidden transition-all duration-200 ease-out ${
          isExpanded ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <ul className="list-none space-y-0.5 mb-2">
          {patterns.map((p) => (
            <li key={p}>
              <button
                type="button"
                className={`group w-full px-3 py-1.5 rounded cursor-pointer transition-colors duration-150 flex items-center gap-2 text-left ${
                  p === selectedPattern ? "bg-accent text-white" : "hover:bg-bg-tertiary"
                }`}
                onClick={() => onSelect(p)}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    p === selectedPattern ? "bg-white" : "bg-text-secondary"
                  }`}
                />
                <span className="text-[13px] flex-1 truncate">{p}</span>
                <span
                  className={`opacity-0 group-hover:opacity-100 transition-opacity duration-150 text-[10px] ${
                    p === selectedPattern ? "text-white/60" : "text-text-secondary"
                  }`}
                  title="Download as ZIP"
                >
                  ⬇ZIP
                </span>
              </button>
            </li>
          ))}
        </ul>

        {showInput ? (
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={newPatternName}
              onChange={(e) => setNewPatternName(e.target.value)}
              placeholder="パターン名"
              className="flex-1 min-w-0 text-sm py-1"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <button type="button" className="btn-primary text-xs px-2 py-1" onClick={handleCreate}>
              作成
            </button>
            <button type="button" className="btn-secondary text-xs px-2 py-1" onClick={() => setShowInput(false)}>
              ✕
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="w-full text-[12px] text-text-secondary hover:text-text-primary transition-colors duration-150 py-1"
            onClick={() => setShowInput(true)}
          >
            + 新規パターン
          </button>
        )}
      </div>
    </div>
  );
}
