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
  scenariosCount: number;
}

/**
 * SSE event type
 */
export type SSEEventType =
  | "connected" // Connection established (initial state sent)
  | "mode_changed" // Mode changed
  | "scenario_changed" // Current scenario changed
  | "scenario_created" // Scenario created
  | "scenario_deleted" // Scenario deleted
  | "scenario_renamed" // Scenario renamed
  | "folder_created" // Folder created
  | "folder_deleted" // Folder deleted
  | "folder_renamed" // Folder renamed
  | "file_created" // File created (during recording)
  | "file_updated" // File updated
  | "file_deleted" // File deleted
  | "request_log"; // Request log entry

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
  currentScenario: string | null;
  scenarios: string[];
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
 * Scenario changed event data
 */
export interface ScenarioChangedEventData {
  scenario: string | null;
  files: FileInfo[];
}

/**
 * Scenario created event data
 */
export interface ScenarioCreatedEventData {
  name: string;
}

/**
 * Scenario deleted event data
 */
export interface ScenarioDeletedEventData {
  name: string;
}

/**
 * Scenario renamed event data
 */
export interface ScenarioRenamedEventData {
  oldName: string;
  newName: string;
}

/**
 * Folder created event data
 */
export interface FolderCreatedEventData {
  name: string;
  scenariosCount?: number;
  scenarios?: string[];
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
  scenario: string;
  filename: string;
  endpoint: string;
  method: string;
}

/**
 * File deleted event data
 */
export interface FileDeletedEventData {
  scenario: string;
  filename: string;
}

/**
 * Request log event data
 */
export interface RequestLogEventData {
  /** Unique identifier for the log entry */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** HTTP method (GET, POST, PUT, DELETE, etc.) */
  method: string;
  /** Request path (e.g., /api/users) */
  path: string;
  /** Primary action taken */
  action: "proxy" | "record" | "mock" | "smart";
  /** Sub-action for smart mode (mock or record) */
  subAction?: "mock" | "record";
  /** HTTP status code */
  status: number;
  /** File path for record/mock actions */
  filePath?: string;
  /** Request duration in milliseconds */
  duration: number;
}
