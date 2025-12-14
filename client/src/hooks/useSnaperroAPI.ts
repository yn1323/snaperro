import { useCallback, useMemo } from "react";
import type { FileData, FileInfo, FolderInfo, Mode, PatternInfo, SearchResult } from "../types";
import { downloadAsFile } from "../utils/download";

const API_BASE = "/__snaperro__";

interface UseSnaperroAPIReturn {
  // モード操作
  setMode: (mode: Mode) => Promise<void>;

  // パターン操作
  getPatterns: () => Promise<PatternInfo[]>;
  setCurrentPattern: (pattern: string | null) => Promise<void>;
  createPattern: (name: string) => Promise<void>;
  duplicatePattern: (name: string, newName: string) => Promise<void>;
  renamePattern: (name: string, newName: string) => Promise<void>;
  deletePattern: (name: string) => Promise<void>;

  // フォルダ操作
  getFolders: () => Promise<FolderInfo[]>;
  createFolder: (name: string) => Promise<void>;
  deleteFolder: (name: string) => Promise<void>;
  renameFolder: (name: string, newName: string) => Promise<void>;
  downloadFolder: (name: string) => Promise<void>;
  uploadFolder: (file: File) => Promise<void>;

  // ファイル操作
  getFiles: (pattern: string) => Promise<FileInfo[]>;
  getFile: (pattern: string, filename: string) => Promise<FileData>;
  updateFile: (pattern: string, filename: string, data: FileData) => Promise<void>;
  deleteFile: (pattern: string, filename: string) => Promise<void>;
  uploadFile: (pattern: string, file: File) => Promise<void>;
  downloadFile: (pattern: string, filename: string) => Promise<void>;
  searchFiles: (pattern: string, query: string) => Promise<SearchResult[]>;
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
  // パターン操作
  // ============================================================
  const getPatterns = useCallback(async (): Promise<PatternInfo[]> => {
    const result = await apiFetch<{ patterns: PatternInfo[] }>(`${API_BASE}/patterns`);
    return result.patterns;
  }, []);

  const setCurrentPattern = useCallback(async (pattern: string | null): Promise<void> => {
    await apiFetch(`${API_BASE}/patterns/current`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern }),
    });
  }, []);

  const createPattern = useCallback(async (name: string): Promise<void> => {
    await apiFetch(`${API_BASE}/patterns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }, []);

  const duplicatePattern = useCallback(async (name: string, newName: string): Promise<void> => {
    await apiFetch(`${API_BASE}/patterns/${encodeURIComponent(name)}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newName }),
    });
  }, []);

  const renamePattern = useCallback(async (name: string, newName: string): Promise<void> => {
    await apiFetch(`${API_BASE}/patterns/${encodeURIComponent(name)}/rename`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newName }),
    });
  }, []);

  const deletePattern = useCallback(async (name: string): Promise<void> => {
    await apiFetch(`${API_BASE}/patterns/${encodeURIComponent(name)}`, {
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
  const getFiles = useCallback(async (pattern: string): Promise<FileInfo[]> => {
    const result = await apiFetch<{ pattern: string; files: FileInfo[] }>(
      `${API_BASE}/patterns/${encodeURIComponent(pattern)}/files`,
    );
    return result.files;
  }, []);

  const getFile = useCallback(async (pattern: string, filename: string): Promise<FileData> => {
    return apiFetch<FileData>(
      `${API_BASE}/patterns/${encodeURIComponent(pattern)}/files/${encodeURIComponent(filename)}`,
    );
  }, []);

  const updateFile = useCallback(async (pattern: string, filename: string, data: FileData): Promise<void> => {
    await apiFetch(`${API_BASE}/patterns/${encodeURIComponent(pattern)}/files/${encodeURIComponent(filename)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }, []);

  const deleteFile = useCallback(async (pattern: string, filename: string): Promise<void> => {
    await apiFetch(`${API_BASE}/patterns/${encodeURIComponent(pattern)}/files/${encodeURIComponent(filename)}`, {
      method: "DELETE",
    });
  }, []);

  const uploadFile = useCallback(async (pattern: string, file: File): Promise<void> => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE}/patterns/${encodeURIComponent(pattern)}/files/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Upload failed" }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
  }, []);

  const downloadFile = useCallback(async (pattern: string, filename: string): Promise<void> => {
    const url = `${API_BASE}/patterns/${encodeURIComponent(pattern)}/files/${encodeURIComponent(filename)}/download`;
    const downloadFilename = filename.endsWith(".json") ? filename : `${filename}.json`;
    await downloadAsFile(url, downloadFilename);
  }, []);

  const searchFiles = useCallback(async (pattern: string, query: string): Promise<SearchResult[]> => {
    const result = await apiFetch<{ pattern: string; query: string; files: SearchResult[] }>(
      `${API_BASE}/patterns/${encodeURIComponent(pattern)}/files/search?q=${encodeURIComponent(query)}`,
    );
    return result.files;
  }, []);

  return useMemo(
    () => ({
      setMode,
      getPatterns,
      setCurrentPattern,
      createPattern,
      duplicatePattern,
      renamePattern,
      deletePattern,
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
      getPatterns,
      setCurrentPattern,
      createPattern,
      duplicatePattern,
      renamePattern,
      deletePattern,
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
