import { EventEmitter } from "node:events";

/**
 * SSE イベント種別
 */
export type ServerEventType =
  | "mode:changed"
  | "pattern:changed"
  | "pattern:created"
  | "pattern:deleted"
  | "pattern:renamed"
  | "pattern:duplicated"
  | "pattern:uploaded"
  | "recordings:changed"
  | "recordings:created"
  | "recordings:deleted"
  | "recordings:uploaded";

/**
 * SSE イベントデータ
 */
export interface ServerEventData {
  type: ServerEventType;
  payload: unknown;
  timestamp: string;
}

/**
 * サーバーイベントエミッター
 * GUI向けSSE通知に使用
 */
class ServerEventEmitter extends EventEmitter {
  private static instance: ServerEventEmitter;

  private constructor() {
    super();
    // 最大リスナー数を増やす（複数クライアント対応）
    this.setMaxListeners(100);
  }

  static getInstance(): ServerEventEmitter {
    if (!ServerEventEmitter.instance) {
      ServerEventEmitter.instance = new ServerEventEmitter();
    }
    return ServerEventEmitter.instance;
  }

  /**
   * イベントを発火
   */
  notify(type: ServerEventType, payload: unknown = {}): void {
    const data: ServerEventData = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
    this.emit("server-event", data);
  }

  /**
   * イベントリスナーを登録
   */
  subscribe(callback: (data: ServerEventData) => void): () => void {
    this.on("server-event", callback);
    return () => this.off("server-event", callback);
  }
}

export const serverEvents = ServerEventEmitter.getInstance();
