import type { Mode } from "../types";

interface TopBarProps {
  mode: Mode;
  connected: boolean;
  onModeChange: (mode: Mode) => void;
}

const modes: { value: Mode; label: string; color: string; activeColor: string }[] = [
  { value: "record", label: "Record", color: "bg-gray-700 hover:bg-gray-600", activeColor: "bg-red-600" },
  { value: "proxy", label: "Proxy", color: "bg-gray-700 hover:bg-gray-600", activeColor: "bg-blue-600" },
  { value: "mock", label: "Mock", color: "bg-gray-700 hover:bg-gray-600", activeColor: "bg-green-600" },
];

/**
 * トップバー
 * モード切替ボタンと接続状態を表示
 */
export function TopBar({ mode, connected, onModeChange }: TopBarProps) {
  return (
    <div className="h-12 bg-gray-800 text-white flex items-center px-4 gap-4 shrink-0">
      {/* ロゴ */}
      <div className="flex items-center gap-2">
        <span className="text-xl font-bold">snaperro</span>
      </div>

      {/* モードセレクター */}
      <div className="flex items-center gap-2 ml-6">
        <div className="flex gap-1">
          {modes.map(({ value, label, color, activeColor }) => (
            <button
              key={value}
              type="button"
              onClick={() => onModeChange(value)}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                mode === value ? activeColor : color
              } text-white`}
            >
              {value === "record" && mode === "record" && <span className="mr-1.5">●</span>}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 接続状態 */}
      <div className="ml-auto flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`} />
        <span className="text-sm text-gray-400">{connected ? "接続中" : "切断"}</span>
      </div>
    </div>
  );
}
