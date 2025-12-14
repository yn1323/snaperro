import type { Mode } from "./mode.js";

/**
 * File information (for list display)
 */
export interface FileInfo {
  filename: string;
  endpoint: string;
  method: string;
}

/**
 * Folder information
 */
export interface FolderInfo {
  name: string;
  patternsCount: number;
}

/**
 * SSE event type
 */
export type SSEEventType =
  | "connected" // Connection established (initial state sent)
  | "mode_changed" // Mode changed
  | "pattern_changed" // Current pattern changed
  | "pattern_created" // Pattern created
  | "pattern_deleted" // Pattern deleted
  | "pattern_renamed" // Pattern renamed
  | "folder_created" // Folder created
  | "folder_deleted" // Folder deleted
  | "folder_renamed" // Folder renamed
  | "file_created" // File created (during recording)
  | "file_updated" // File updated
  | "file_deleted"; // File deleted

/**
 * SSE event
 */
export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
  timestamp: string;
}

/**
 * Connected event data
 */
export interface ConnectedEventData {
  version: string;
  mode: Mode;
  currentPattern: string | null;
  patterns: string[];
  folders: FolderInfo[];
  files: FileInfo[];
}

/**
 * Mode changed event data
 */
export interface ModeChangedEventData {
  mode: Mode;
}

/**
 * Pattern changed event data
 */
export interface PatternChangedEventData {
  pattern: string | null;
  files: FileInfo[];
}

/**
 * Pattern created event data
 */
export interface PatternCreatedEventData {
  name: string;
}

/**
 * Pattern deleted event data
 */
export interface PatternDeletedEventData {
  name: string;
}

/**
 * Pattern renamed event data
 */
export interface PatternRenamedEventData {
  oldName: string;
  newName: string;
}

/**
 * Folder created event data
 */
export interface FolderCreatedEventData {
  name: string;
  patternsCount?: number;
  patterns?: string[];
}

/**
 * Folder deleted event data
 */
export interface FolderDeletedEventData {
  name: string;
}

/**
 * Folder renamed event data
 */
export interface FolderRenamedEventData {
  oldName: string;
  newName: string;
}

/**
 * File created/updated event data
 */
export interface FileChangedEventData {
  pattern: string;
  filename: string;
  endpoint: string;
  method: string;
}

/**
 * File deleted event data
 */
export interface FileDeletedEventData {
  pattern: string;
  filename: string;
}
