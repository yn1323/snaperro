import type { MiddlewareHandler } from "hono";

/**
 * CORSミドルウェア（常に許可）
 */
export function cors(): MiddlewareHandler {
  return async (c, next) => {
    // プリフライトリクエスト
    if (c.req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "*",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    await next();

    // レスポンスヘッダー追加
    c.res.headers.set("Access-Control-Allow-Origin", "*");
  };
}
