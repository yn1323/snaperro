import { Hono } from "hono";
import { type Mode, state } from "../core/state.js";
import { storage } from "../core/storage.js";

/**
 * 制御API
 * /__snaperro__/* エンドポイントでモード・パターン管理
 */
export const controlApi = new Hono();

/**
 * 状態取得
 * GET /__snaperro__/status
 */
controlApi.get("/status", (c) => {
  return c.json({
    mode: state.getMode(),
    pattern: state.getPattern(),
  });
});

/**
 * モード変更
 * POST /__snaperro__/mode
 * Body: { mode: "proxy" | "record" | "mock" }
 */
controlApi.post("/mode", async (c) => {
  const body = await c.req.json<{ mode: string }>();
  const mode = body.mode?.toLowerCase();

  if (!["proxy", "record", "mock"].includes(mode)) {
    return c.json({ error: "Invalid mode. Use: proxy, record, mock" }, 400);
  }

  state.setMode(mode as Mode);
  return c.json({ mode: state.getMode() });
});

/**
 * パターン変更
 * POST /__snaperro__/pattern
 * Body: { pattern: string }
 */
controlApi.post("/pattern", async (c) => {
  const body = await c.req.json<{ pattern: string }>();
  const pattern = body.pattern;

  if (!pattern || typeof pattern !== "string") {
    return c.json({ error: "Pattern is required" }, 400);
  }

  state.setPattern(pattern);
  return c.json({ pattern: state.getPattern() });
});

/**
 * カウンターリセット
 * POST /__snaperro__/reset
 */
controlApi.post("/reset", (c) => {
  state.resetCounter();
  return c.json({ message: "Counters reset" });
});

/**
 * パターン一覧取得
 * GET /__snaperro__/patterns
 */
controlApi.get("/patterns", async (c) => {
  const patterns = await storage.listPatterns();
  return c.json({ patterns });
});

/**
 * パターン作成
 * POST /__snaperro__/patterns
 * Body: { name: string }
 */
controlApi.post("/patterns", async (c) => {
  const body = await c.req.json<{ name: string }>();
  const name = body.name;

  if (!name || typeof name !== "string") {
    return c.json({ error: "Name is required" }, 400);
  }

  await storage.createPattern(name);
  return c.json({ message: "Pattern created", name }, 201);
});

/**
 * パターン内のファイル一覧取得
 * GET /__snaperro__/patterns/:name/files
 */
controlApi.get("/patterns/:name/files", async (c) => {
  const name = c.req.param("name");
  const files = await storage.getPatternFiles(name);
  return c.json({ files });
});

/**
 * ファイル内容取得
 * GET /__snaperro__/files/*
 */
controlApi.get("/files/*", async (c) => {
  const filePath = c.req.path.replace("/__snaperro__/files/", "");

  try {
    const data = await storage.read(filePath);
    return c.json(data);
  } catch {
    return c.json({ error: "File not found" }, 404);
  }
});

/**
 * ファイル削除
 * DELETE /__snaperro__/files/*
 */
controlApi.delete("/files/*", async (c) => {
  const filePath = c.req.path.replace("/__snaperro__/files/", "");

  try {
    await storage.deleteFile(filePath);
    return c.json({ message: "File deleted" });
  } catch {
    return c.json({ error: "File not found" }, 404);
  }
});
