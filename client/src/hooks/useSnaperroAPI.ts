import { useCallback, useMemo } from "react";
import type { FileData, FileInfo, FolderInfo, Mode, ScenarioInfo, SearchResult } from "../types";
import { downloadAsFile } from "../utils/download";

const API_BASE = "/__snaperro__";

interface UseSnaperroAPIReturn {
  // モード操作
  setMode: (mode: Mode) => Promise<void>;

  // シナリオ操作
  getScenarios: () => Promise<ScenarioInfo[]>;
  setCurrentScenario: (scenario: string | null) => Promise<void>;
  createScenario: (name: string) => Promise<void>;
  duplicateScenario: (name: string, newName: string) => Promise<void>;
  renameScenario: (name: string, newName: string) => Promise<void>;
  deleteScenario: (name: string) => Promise<void>;

  // フォルダ操作
  getFolders: () => Promise<FolderInfo[]>;
  createFolder: (name: string) => Promise<void>;
  deleteFolder: (name: string) => Promise<void>;
  renameFolder: (name: string, newName: string) => Promise<void>;
  downloadFolder: (name: string) => Promise<void>;
  uploadFolder: (file: File) => Promise<void>;

  // ファイル操作
  getFiles: (scenario: string) => Promise<FileInfo[]>;
  getFile: (scenario: string, filename: string) => Promise<FileData>;
  updateFile: (scenario: string, filename: string, data: FileData) => Promise<void>;
  deleteFile: (scenario: string, filename: string) => Promise<void>;
  uploadFile: (scenario: string, file: File) => Promise<void>;
  downloadFile: (scenario: string, filename: string) => Promise<void>;
  searchFiles: (scenario: string, query: string) => Promise<SearchResult[]>;
}

/**
 * APIリクエストのラッパー
 */
async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * snaperro API操作を提供するフック
 */
export function useSnaperroAPI(): UseSnaperroAPIReturn {
  // ============================================================
  // モード操作
  // ============================================================
  const setMode = useCallback(async (mode: Mode): Promise<void> => {
    await apiFetch(`${API_BASE}/mode`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
  }, []);

  // ============================================================
  // シナリオ操作
  // ============================================================
  const getScenarios = useCallback(async (): Promise<ScenarioInfo[]> => {
    const result = await apiFetch<{ scenarios: ScenarioInfo[] }>(`${API_BASE}/scenarios`);
    return result.scenarios;
  }, []);

  const setCurrentScenario = useCallback(async (scenario: string | null): Promise<void> => {
    await apiFetch(`${API_BASE}/scenarios/current`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario }),
    });
  }, []);

  const createScenario = useCallback(async (name: string): Promise<void> => {
    await apiFetch(`${API_BASE}/scenarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }, []);

  const duplicateScenario = useCallback(async (name: string, newName: string): Promise<void> => {
    await apiFetch(`${API_BASE}/scenarios/${encodeURIComponent(name)}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newName }),
    });
  }, []);

  const renameScenario = useCallback(async (name: string, newName: string): Promise<void> => {
    await apiFetch(`${API_BASE}/scenarios/${encodeURIComponent(name)}/rename`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newName }),
    });
  }, []);

  const deleteScenario = useCallback(async (name: string): Promise<void> => {
    await apiFetch(`${API_BASE}/scenarios/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }, []);

  // ============================================================
  // フォルダ操作
  // ============================================================
  const getFolders = useCallback(async (): Promise<FolderInfo[]> => {
    const result = await apiFetch<{ folders: FolderInfo[] }>(`${API_BASE}/folders`);
    return result.folders;
  }, []);

  const createFolder = useCallback(async (name: string): Promise<void> => {
    await apiFetch(`${API_BASE}/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }, []);

  const deleteFolder = useCallback(async (name: string): Promise<void> => {
    await apiFetch(`${API_BASE}/folders/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }, []);

  const renameFolder = useCallback(async (name: string, newName: string): Promise<void> => {
    await apiFetch(`${API_BASE}/folders/${encodeURIComponent(name)}/rename`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newName }),
    });
  }, []);

  const downloadFolder = useCallback(async (name: string): Promise<void> => {
    const url = `${API_BASE}/folders/${encodeURIComponent(name)}/download`;
    await downloadAsFile(url, `${name}.zip`);
  }, []);

  const uploadFolder = useCallback(async (file: File): Promise<void> => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE}/folders/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Upload failed" }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
  }, []);

  // ============================================================
  // ファイル操作
  // ============================================================
  const getFiles = useCallback(async (scenario: string): Promise<FileInfo[]> => {
    const result = await apiFetch<{ scenario: string; files: FileInfo[] }>(
      `${API_BASE}/scenarios/${encodeURIComponent(scenario)}/files`,
    );
    return result.files;
  }, []);

  const getFile = useCallback(async (scenario: string, filename: string): Promise<FileData> => {
    return apiFetch<FileData>(
      `${API_BASE}/scenarios/${encodeURIComponent(scenario)}/files/${encodeURIComponent(filename)}`,
    );
  }, []);

  const updateFile = useCallback(async (scenario: string, filename: string, data: FileData): Promise<void> => {
    await apiFetch(`${API_BASE}/scenarios/${encodeURIComponent(scenario)}/files/${encodeURIComponent(filename)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }, []);

  const deleteFile = useCallback(async (scenario: string, filename: string): Promise<void> => {
    await apiFetch(`${API_BASE}/scenarios/${encodeURIComponent(scenario)}/files/${encodeURIComponent(filename)}`, {
      method: "DELETE",
    });
  }, []);

  const uploadFile = useCallback(async (scenario: string, file: File): Promise<void> => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE}/scenarios/${encodeURIComponent(scenario)}/files/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Upload failed" }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
  }, []);

  const downloadFile = useCallback(async (scenario: string, filename: string): Promise<void> => {
    const url = `${API_BASE}/scenarios/${encodeURIComponent(scenario)}/files/${encodeURIComponent(filename)}/download`;
    const downloadFilename = filename.endsWith(".json") ? filename : `${filename}.json`;
    await downloadAsFile(url, downloadFilename);
  }, []);

  const searchFiles = useCallback(async (scenario: string, query: string): Promise<SearchResult[]> => {
    const result = await apiFetch<{ scenario: string; query: string; files: SearchResult[] }>(
      `${API_BASE}/scenarios/${encodeURIComponent(scenario)}/files/search?q=${encodeURIComponent(query)}`,
    );
    return result.files;
  }, []);

  return useMemo(
    () => ({
      setMode,
      getScenarios,
      setCurrentScenario,
      createScenario,
      duplicateScenario,
      renameScenario,
      deleteScenario,
      getFolders,
      createFolder,
      deleteFolder,
      renameFolder,
      downloadFolder,
      uploadFolder,
      getFiles,
      getFile,
      updateFile,
      deleteFile,
      uploadFile,
      downloadFile,
      searchFiles,
    }),
    [
      setMode,
      getScenarios,
      setCurrentScenario,
      createScenario,
      duplicateScenario,
      renameScenario,
      deleteScenario,
      getFolders,
      createFolder,
      deleteFolder,
      renameFolder,
      downloadFolder,
      uploadFolder,
      getFiles,
      getFile,
      updateFile,
      deleteFile,
      uploadFile,
      downloadFile,
      searchFiles,
    ],
  );
}
