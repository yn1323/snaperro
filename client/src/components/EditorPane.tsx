import { useEffect, useState } from "react";
import type { FileData } from "../types";

interface EditorPaneProps {
  fileData: FileData | null;
  filename: string | null;
  isLoading: boolean;
  onSave: (data: FileData) => void;
  onDelete: () => void;
}

/**
 * Right pane - JSON editor
 * Uses remaining width
 */
export function EditorPane({ fileData, filename, isLoading, onSave, onDelete }: EditorPaneProps) {
  const [editedContent, setEditedContent] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Update editor when file data changes
  useEffect(() => {
    if (fileData) {
      const formatted = JSON.stringify(fileData, null, 2);
      setEditedContent(formatted);
      setHasChanges(false);
      setParseError(null);
    } else {
      setEditedContent("");
      setHasChanges(false);
      setParseError(null);
    }
  }, [fileData]);

  const handleContentChange = (value: string) => {
    setEditedContent(value);
    setHasChanges(true);

    // JSON validation
    try {
      JSON.parse(value);
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(editedContent);
      const formatted = JSON.stringify(parsed, null, 2);
      setEditedContent(formatted);
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const handleSave = () => {
    if (parseError) return;
    try {
      const data = JSON.parse(editedContent) as FileData;
      onSave(data);
      setHasChanges(false);
    } catch {
      // Parse should have succeeded if parseError is null
    }
  };

  // No file selected
  if (!filename) {
    return (
      <div className="flex-1 bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Select a file</div>
      </div>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <div className="flex-1 bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-white flex flex-col min-w-0">
      {/* Header */}
      <div className="p-2 border-b border-gray-300 bg-gray-50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-sm text-gray-700 truncate" title={filename}>
            {filename}
          </span>
          {hasChanges && <span className="text-xs text-orange-500 shrink-0">*Unsaved</span>}
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={handleFormat}
            disabled={!!parseError}
            className="text-xs bg-gray-500 text-white px-3 py-1 rounded hover:bg-gray-600 disabled:bg-gray-300 cursor-pointer disabled:cursor-not-allowed"
          >
            Format
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!!parseError || !hasChanges}
            className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 disabled:bg-gray-300 cursor-pointer disabled:cursor-not-allowed"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="text-xs bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 cursor-pointer"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Parse error display */}
      {parseError && (
        <div className="px-3 py-2 bg-red-100 text-red-700 text-xs border-b border-red-200 shrink-0">
          JSON Error: {parseError}
        </div>
      )}

      {/* Editor */}
      <textarea
        value={editedContent}
        onChange={(e) => handleContentChange(e.target.value)}
        className="flex-1 p-4 font-mono text-sm resize-none focus:outline-none bg-gray-900 text-gray-100"
        spellCheck={false}
      />
    </div>
  );
}
