import { EventEmitter } from "node:events";
import type { SSEEvent, SSEEventType } from "../types/sse.js";

/**
 * SSEイベントバス
 * サーバー内の状態変更をSSEクライアントに通知するための中央イベントハブ
 */
class SSEEventBus extends EventEmitter {
  private static readonly SSE_EVENT = "sse";

  /**
   * イベントを発行
   * @param type イベント種別
   * @param data イベントデータ
   */
  emitSSE(type: SSEEventType, data: unknown): void {
    const event: SSEEvent = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };
    this.emit(SSEEventBus.SSE_EVENT, event);
  }

  /**
   * イベントを購読
   * @param callback イベントハンドラ
   * @returns 購読解除関数
   */
  subscribe(callback: (event: SSEEvent) => void): () => void {
    this.on(SSEEventBus.SSE_EVENT, callback);
    return () => this.off(SSEEventBus.SSE_EVENT, callback);
  }
}

// シングルトンインスタンス
export const eventBus = new SSEEventBus();
