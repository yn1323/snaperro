import type { EndpointInfo } from "./types";

interface EndpointItemProps {
  endpoint: EndpointInfo;
  isSelected: boolean;
  onSelect: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

function getMethodChar(method: string): string {
  const m = method.toUpperCase();
  if (m === "PATCH") return "A";
  return m[0] || "?";
}

function getMethodColorClass(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "bg-method-get text-bg-primary";
    case "POST":
      return "bg-method-post text-bg-primary";
    case "PUT":
      return "bg-method-put text-bg-primary";
    case "PATCH":
      return "bg-method-patch text-bg-primary";
    case "DELETE":
      return "bg-method-delete text-bg-primary";
    default:
      return "bg-bg-tertiary text-text-primary";
  }
}

function getStatusColorClass(status: number): string {
  if (status >= 200 && status < 300) return "text-success";
  if (status >= 400 && status < 500) return "text-warning";
  if (status >= 500) return "text-error";
  return "text-text-secondary";
}

export function EndpointItem({ endpoint, isSelected, onSelect }: EndpointItemProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group w-full flex items-center gap-2 px-2 py-1 rounded text-left transition-colors duration-150 ${
        isSelected ? "bg-accent text-white" : "hover:bg-bg-tertiary"
      }`}
    >
      <span
        className={`w-4 h-4 flex items-center justify-center rounded-sm text-[10px] font-bold shrink-0 ${
          isSelected ? "bg-white/20 text-white" : getMethodColorClass(endpoint.method)
        }`}
      >
        {getMethodChar(endpoint.method)}
      </span>
      <span
        className={`text-[11px] font-mono tabular-nums ${
          isSelected ? "text-white/90" : getStatusColorClass(endpoint.status)
        }`}
      >
        {endpoint.status}
      </span>
      <span className={`text-[11px] font-mono tabular-nums ${isSelected ? "text-white/70" : "text-text-secondary"}`}>
        {formatSize(endpoint.size)}
      </span>
      <span
        className={`ml-auto opacity-0 group-hover:opacity-100 transition-opacity duration-150 text-[11px] ${
          isSelected ? "text-white/60" : "text-text-secondary"
        }`}
        title="Download JSON"
      >
        ⬇
      </span>
    </button>
  );
}
