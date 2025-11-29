import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * GUI配信用ルーター
 * ビルド済みのGUIを /__snaperro__/gui/* で配信
 */
export const guiRouter = new Hono();

// GUIのビルドディレクトリ（開発時: プロジェクトルートの gui/dist）
const GUI_DIR = path.resolve(__dirname, "../../gui/dist");

// Content-Type マッピング
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * 静的ファイルを配信
 */
guiRouter.get("/*", async (c) => {
  let filePath = c.req.path.replace("/__snaperro__/gui", "");
  if (filePath === "" || filePath === "/") {
    filePath = "/index.html";
  }

  const fullPath = path.join(GUI_DIR, filePath);

  try {
    const content = await fs.readFile(fullPath);
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    return new Response(content, {
      headers: {
        "Content-Type": contentType,
      },
    });
  } catch {
    // ファイルが見つからない場合は index.html を返す（SPA対応）
    try {
      const indexPath = path.join(GUI_DIR, "index.html");
      const content = await fs.readFile(indexPath);
      return new Response(content, {
        headers: {
          "Content-Type": "text/html",
        },
      });
    } catch {
      return c.json({ error: "GUI not found. Run 'pnpm build:gui' first." }, 404);
    }
  }
});
