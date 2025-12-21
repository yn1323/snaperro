/**
 * Client-side type definitions
 * Common types are imported from shared, client-specific types are defined here
 */

// Re-export shared types
export type {
  ConnectedEventData,
  FileChangedEventData,
  FileData,
  FileDeletedEventData,
  FileInfo,
  FileRequest,
  FileResponse,
  FolderCreatedEventData,
  FolderDeletedEventData,
  FolderInfo,
  FolderRenamedEventData,
  HttpMethod,
  Mode,
  ModeChangedEventData,
  RequestLogEventData,
  ScenarioChangedEventData,
  ScenarioCreatedEventData,
  ScenarioDeletedEventData,
  ScenarioRenamedEventData,
  SSEEvent,
  SSEEventType,
} from "@snaperro/shared/types/index.js";

// Import for use in local types
import type { FileInfo, FolderInfo, Mode } from "@snaperro/shared/types/index.js";

// ============================================================
// Client-specific types
// ============================================================

/**
 * Scenario information
 */
export interface ScenarioInfo {
  name: string;
  filesCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Application state (managed via SSE)
 */
export interface SnaperroState {
  version: string;
  mode: Mode;
  currentScenario: string | null;
  scenarios: string[];
  folders: FolderInfo[];
  files: FileInfo[];
}

/**
 * Search result
 */
export interface SearchResult {
  filename: string;
  endpoint: string;
  method: string;
}
