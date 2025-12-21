import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConnectedEventData,
  FileChangedEventData,
  FileDeletedEventData,
  FileInfo,
  FolderCreatedEventData,
  FolderDeletedEventData,
  FolderRenamedEventData,
  Mode,
  ModeChangedEventData,
  ScenarioChangedEventData,
  ScenarioCreatedEventData,
  ScenarioDeletedEventData,
  ScenarioRenamedEventData,
  SnaperroState,
  SSEEventType,
} from "../types";

const RECONNECT_DELAY = 3000; // 3秒
const SSE_ENDPOINT = "/__snaperro__/events";

interface UseSnaperroSSEReturn {
  state: SnaperroState;
  connected: boolean;
}

const initialState: SnaperroState = {
  version: "",
  mode: "proxy",
  currentScenario: null,
  scenarios: [],
  folders: [],
  files: [],
};

/**
 * SSE接続を管理するフック
 * サーバーからのリアルタイムイベントを受信し、状態を更新する
 */
export function useSnaperroSSE(): UseSnaperroSSEReturn {
  const [state, setState] = useState<SnaperroState>(initialState);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  // イベントハンドラ
  const handleConnected = useCallback((data: ConnectedEventData) => {
    setState({
      version: data.version,
      mode: data.mode as Mode,
      currentScenario: data.currentScenario,
      scenarios: data.scenarios,
      folders: data.folders,
      files: data.files,
    });
    setConnected(true);
  }, []);

  const handleModeChanged = useCallback((data: ModeChangedEventData) => {
    setState((prev) => ({ ...prev, mode: data.mode }));
  }, []);

  const handleScenarioChanged = useCallback((data: ScenarioChangedEventData) => {
    setState((prev) => ({
      ...prev,
      currentScenario: data.scenario,
      files: data.files,
    }));
  }, []);

  const handleScenarioCreated = useCallback((data: ScenarioCreatedEventData) => {
    setState((prev) => {
      // シナリオ名からフォルダ名を抽出（folder/scenario 形式）
      const folderName = data.name.includes("/") ? data.name.split("/")[0] : null;
      return {
        ...prev,
        scenarios: [...prev.scenarios, data.name].sort(),
        // フォルダの件数をインクリメント
        folders: folderName
          ? prev.folders.map((f) => (f.name === folderName ? { ...f, scenariosCount: f.scenariosCount + 1 } : f))
          : prev.folders,
      };
    });
  }, []);

  const handleScenarioDeleted = useCallback((data: ScenarioDeletedEventData) => {
    setState((prev) => {
      // シナリオ名からフォルダ名を抽出（folder/scenario 形式）
      const folderName = data.name.includes("/") ? data.name.split("/")[0] : null;
      return {
        ...prev,
        scenarios: prev.scenarios.filter((p) => p !== data.name),
        // フォルダの件数をデクリメント
        folders: folderName
          ? prev.folders.map((f) =>
              f.name === folderName ? { ...f, scenariosCount: Math.max(0, f.scenariosCount - 1) } : f,
            )
          : prev.folders,
      };
    });
  }, []);

  const handleScenarioRenamed = useCallback((data: ScenarioRenamedEventData) => {
    setState((prev) => ({
      ...prev,
      scenarios: prev.scenarios.map((p) => (p === data.oldName ? data.newName : p)).sort(),
      currentScenario: prev.currentScenario === data.oldName ? data.newName : prev.currentScenario,
    }));
  }, []);

  const handleFolderCreated = useCallback((data: FolderCreatedEventData) => {
    setState((prev) => ({
      ...prev,
      folders: [...prev.folders, { name: data.name, scenariosCount: data.scenariosCount ?? 0 }].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      scenarios: data.scenarios ? [...prev.scenarios, ...data.scenarios].sort() : prev.scenarios,
    }));
  }, []);

  const handleFolderDeleted = useCallback((data: FolderDeletedEventData) => {
    setState((prev) => ({
      ...prev,
      folders: prev.folders.filter((f) => f.name !== data.name),
    }));
  }, []);

  const handleFolderRenamed = useCallback((data: FolderRenamedEventData) => {
    setState((prev) => ({
      ...prev,
      folders: prev.folders
        .map((f) => (f.name === data.oldName ? { ...f, name: data.newName } : f))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, []);

  const handleFileCreated = useCallback((data: FileChangedEventData) => {
    setState((prev) => {
      // 現在のシナリオのファイルのみ追加
      if (prev.currentScenario !== data.scenario) return prev;
      const newFile: FileInfo = {
        filename: data.filename,
        endpoint: data.endpoint,
        method: data.method,
      };
      return {
        ...prev,
        files: [...prev.files, newFile],
      };
    });
  }, []);

  const handleFileUpdated = useCallback((data: FileChangedEventData) => {
    setState((prev) => {
      if (prev.currentScenario !== data.scenario) return prev;
      return {
        ...prev,
        files: prev.files.map((f) =>
          f.filename === data.filename ? { ...f, endpoint: data.endpoint, method: data.method } : f,
        ),
      };
    });
  }, []);

  const handleFileDeleted = useCallback((data: FileDeletedEventData) => {
    setState((prev) => {
      if (prev.currentScenario !== data.scenario) return prev;
      return {
        ...prev,
        files: prev.files.filter((f) => f.filename !== data.filename),
      };
    });
  }, []);

  // 接続管理
  const connect = useCallback(() => {
    // 既存の接続をクリーンアップ
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(SSE_ENDPOINT);
    eventSourceRef.current = eventSource;

    // 各イベントタイプにリスナーを登録
    const eventTypes: SSEEventType[] = [
      "connected",
      "mode_changed",
      "scenario_changed",
      "scenario_created",
      "scenario_deleted",
      "scenario_renamed",
      "folder_created",
      "folder_deleted",
      "folder_renamed",
      "file_created",
      "file_updated",
      "file_deleted",
    ];

    for (const eventType of eventTypes) {
      eventSource.addEventListener(eventType, (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          switch (eventType) {
            case "connected":
              handleConnected(data);
              break;
            case "mode_changed":
              handleModeChanged(data);
              break;
            case "scenario_changed":
              handleScenarioChanged(data);
              break;
            case "scenario_created":
              handleScenarioCreated(data);
              break;
            case "scenario_deleted":
              handleScenarioDeleted(data);
              break;
            case "scenario_renamed":
              handleScenarioRenamed(data);
              break;
            case "folder_created":
              handleFolderCreated(data);
              break;
            case "folder_deleted":
              handleFolderDeleted(data);
              break;
            case "folder_renamed":
              handleFolderRenamed(data);
              break;
            case "file_created":
              handleFileCreated(data);
              break;
            case "file_updated":
              handleFileUpdated(data);
              break;
            case "file_deleted":
              handleFileDeleted(data);
              break;
          }
        } catch (err) {
          console.error(`SSEイベントのパースに失敗: ${eventType}`, err);
        }
      });
    }

    eventSource.onerror = () => {
      setConnected(false);
      eventSource.close();

      // 再接続をスケジュール
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, RECONNECT_DELAY);
    };
  }, [
    handleConnected,
    handleModeChanged,
    handleScenarioChanged,
    handleScenarioCreated,
    handleScenarioDeleted,
    handleScenarioRenamed,
    handleFolderCreated,
    handleFolderDeleted,
    handleFolderRenamed,
    handleFileCreated,
    handleFileUpdated,
    handleFileDeleted,
  ]);

  // 初期接続とクリーンアップ
  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  return { state, connected };
}
