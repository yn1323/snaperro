import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConnectedEventData,
  FileChangedEventData,
  FileDeletedEventData,
  FileInfo,
  Mode,
  ModeChangedEventData,
  PatternChangedEventData,
  PatternCreatedEventData,
  PatternDeletedEventData,
  PatternRenamedEventData,
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
  currentPattern: null,
  patterns: [],
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
      currentPattern: data.currentPattern,
      patterns: data.patterns,
      files: data.files,
    });
    setConnected(true);
  }, []);

  const handleModeChanged = useCallback((data: ModeChangedEventData) => {
    setState((prev) => ({ ...prev, mode: data.mode }));
  }, []);

  const handlePatternChanged = useCallback((data: PatternChangedEventData) => {
    setState((prev) => ({
      ...prev,
      currentPattern: data.pattern,
      files: data.files,
    }));
  }, []);

  const handlePatternCreated = useCallback((data: PatternCreatedEventData) => {
    setState((prev) => ({
      ...prev,
      patterns: [...prev.patterns, data.name].sort(),
    }));
  }, []);

  const handlePatternDeleted = useCallback((data: PatternDeletedEventData) => {
    setState((prev) => ({
      ...prev,
      patterns: prev.patterns.filter((p) => p !== data.name),
    }));
  }, []);

  const handlePatternRenamed = useCallback((data: PatternRenamedEventData) => {
    setState((prev) => ({
      ...prev,
      patterns: prev.patterns.map((p) => (p === data.oldName ? data.newName : p)).sort(),
      currentPattern: prev.currentPattern === data.oldName ? data.newName : prev.currentPattern,
    }));
  }, []);

  const handleFileCreated = useCallback((data: FileChangedEventData) => {
    setState((prev) => {
      // 現在のパターンのファイルのみ追加
      if (prev.currentPattern !== data.pattern) return prev;
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
      if (prev.currentPattern !== data.pattern) return prev;
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
      if (prev.currentPattern !== data.pattern) return prev;
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
      "pattern_changed",
      "pattern_created",
      "pattern_deleted",
      "pattern_renamed",
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
            case "pattern_changed":
              handlePatternChanged(data);
              break;
            case "pattern_created":
              handlePatternCreated(data);
              break;
            case "pattern_deleted":
              handlePatternDeleted(data);
              break;
            case "pattern_renamed":
              handlePatternRenamed(data);
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
    handlePatternChanged,
    handlePatternCreated,
    handlePatternDeleted,
    handlePatternRenamed,
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
