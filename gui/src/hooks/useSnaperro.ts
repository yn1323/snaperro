import { useCallback, useEffect, useState } from "react";
import { api, type FileInfo, type Mode, type Status } from "../api/client";

export function useSnaperro() {
  const [status, setStatus] = useState<Status | null>(null);
  const [patterns, setPatterns] = useState<string[]>([]);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.getStatus();
      setStatus(data);
      setError(null);
    } catch {
      setError("サーバーに接続できません");
    }
  }, []);

  const fetchPatterns = useCallback(async () => {
    try {
      const data = await api.getPatterns();
      setPatterns(data.patterns);
    } catch {
      // ignore
    }
  }, []);

  const fetchFiles = useCallback(async (pattern: string) => {
    if (!pattern) {
      setFiles([]);
      return;
    }
    try {
      const data = await api.getPatternFiles(pattern);
      setFiles(data.files);
    } catch {
      setFiles([]);
    }
  }, []);

  const changeMode = useCallback(async (mode: Mode) => {
    try {
      const data = await api.setMode(mode);
      setStatus((prev) => (prev ? { ...prev, mode: data.mode } : null));
    } catch {
      setError("モードの変更に失敗しました");
    }
  }, []);

  const changePattern = useCallback(
    async (pattern: string) => {
      try {
        const data = await api.setPattern(pattern);
        setStatus((prev) => (prev ? { ...prev, pattern: data.pattern } : null));
        await fetchFiles(pattern);
      } catch {
        setError("パターンの変更に失敗しました");
      }
    },
    [fetchFiles],
  );

  const createPattern = useCallback(
    async (name: string) => {
      try {
        await api.createPattern(name);
        await fetchPatterns();
      } catch {
        setError("パターンの作成に失敗しました");
      }
    },
    [fetchPatterns],
  );

  const resetCounter = useCallback(async () => {
    try {
      await api.resetCounter();
    } catch {
      setError("カウンターのリセットに失敗しました");
    }
  }, []);

  const selectFile = useCallback(async (filePath: string | null) => {
    setSelectedFile(filePath);
    if (filePath) {
      try {
        const content = await api.getFile(filePath);
        setFileContent(content);
      } catch {
        setFileContent(null);
      }
    } else {
      setFileContent(null);
    }
  }, []);

  const deleteFile = useCallback(
    async (filePath: string) => {
      try {
        await api.deleteFile(filePath);
        if (status?.pattern) {
          await fetchFiles(status.pattern);
        }
        if (selectedFile === filePath) {
          setSelectedFile(null);
          setFileContent(null);
        }
      } catch {
        setError("ファイルの削除に失敗しました");
      }
    },
    [status?.pattern, fetchFiles, selectedFile],
  );

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await fetchStatus();
      await fetchPatterns();
      setLoading(false);
    };
    init();
  }, [fetchStatus, fetchPatterns]);

  useEffect(() => {
    if (status?.pattern) {
      fetchFiles(status.pattern);
    }
  }, [status?.pattern, fetchFiles]);

  return {
    status,
    patterns,
    files,
    selectedFile,
    fileContent,
    loading,
    error,
    changeMode,
    changePattern,
    createPattern,
    resetCounter,
    selectFile,
    deleteFile,
    refresh: fetchStatus,
  };
}
