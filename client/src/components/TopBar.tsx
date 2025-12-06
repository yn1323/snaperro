import type { Mode } from "../types";

interface TopBarProps {
  version: string;
  mode: Mode;
  connected: boolean;
  onModeChange: (mode: Mode) => void;
  onRecordRequest: () => void;
}

const modes: { value: Mode; label: string; color: string; activeColor: string }[] = [
  { value: "record", label: "Record", color: "bg-gray-700 hover:bg-gray-600", activeColor: "bg-red-600" },
  { value: "proxy", label: "Proxy", color: "bg-gray-700 hover:bg-gray-600", activeColor: "bg-blue-600" },
  { value: "mock", label: "Mock", color: "bg-gray-700 hover:bg-gray-600", activeColor: "bg-green-600" },
];

/**
 * Top bar
 * Displays mode switch buttons and connection status
 */
export function TopBar({ version, mode, connected, onModeChange, onRecordRequest }: TopBarProps) {
  const handleModeClick = (targetMode: Mode) => {
    if (targetMode === "record" && mode !== "record") {
      // Execute special flow when switching to Record mode
      onRecordRequest();
    } else {
      onModeChange(targetMode);
    }
  };

  return (
    <div className="h-12 bg-gray-800 text-white flex items-center px-4 gap-4 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <span className="text-xl">🐕</span>
        <span className="text-xl font-bold">snaperro</span>
        {version && <span className="text-xs text-gray-400">v{version}</span>}
      </div>

      {/* Mode selector */}
      <div className="flex items-center gap-2 ml-6">
        <div className="flex gap-1">
          {modes.map(({ value, label, color, activeColor }) => (
            <button
              key={value}
              type="button"
              onClick={() => handleModeClick(value)}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors cursor-pointer ${
                mode === value ? activeColor : color
              } text-white`}
            >
              {value === "record" && mode === "record" && <span className="mr-1.5">●</span>}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Connection status */}
      <div className="ml-auto flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`} />
        <span className="text-sm text-gray-400">{connected ? "Connected" : "Disconnected"}</span>
      </div>
    </div>
  );
}
