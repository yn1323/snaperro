import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { Hono } from "hono";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export interface StaticAssetMount {
  mountPath: string;
  root: string;
  missingIndexMessage: string;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function requestedAssetPath(requestUrl: string, mountPath: string): string | undefined {
  const pathname = new URL(requestUrl).pathname;
  if (pathname !== mountPath && pathname !== `${mountPath}/` && !pathname.startsWith(`${mountPath}/`)) {
    return undefined;
  }

  const encoded = pathname.slice(mountPath.length).replace(/^\/+/, "");
  if (encoded === "") return "index.html";

  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0") || decoded.includes("\\") || path.isAbsolute(decoded)) return undefined;
  const segments = decoded.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return undefined;
  return segments.join(path.sep);
}

async function resolveSafeAsset(root: string, requestedPath: string): Promise<string | undefined> {
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, requestedPath);
  if (!isWithin(absoluteRoot, candidate)) return undefined;

  try {
    const [realRoot, realCandidate] = await Promise.all([fs.realpath(absoluteRoot), fs.realpath(candidate)]);
    if (!isWithin(realRoot, realCandidate)) return undefined;
    const stat = await fs.stat(realCandidate);
    return stat.isFile() ? realCandidate : undefined;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EACCES") return undefined;
    throw error;
  }
}

/** Mounts one immutable frontend distribution without allowing traversal or escaping symlinks. */
export function mountStaticAssets(app: Hono, options: StaticAssetMount): void {
  if (!options.mountPath.startsWith("/") || options.mountPath.endsWith("/")) {
    throw new TypeError("Static asset mountPath must be an absolute path without a trailing slash");
  }

  app.on(["GET", "HEAD"], [options.mountPath, `${options.mountPath}/`, `${options.mountPath}/*`], async (context) => {
    const requestedPath = requestedAssetPath(context.req.url, options.mountPath);
    if (!requestedPath) return context.notFound();

    const asset = await resolveSafeAsset(options.root, requestedPath);
    if (!asset) {
      return requestedPath === "index.html" ? context.text(options.missingIndexMessage, 404) : context.notFound();
    }

    const stat = await fs.stat(asset);
    const headers = new Headers({
      "Cache-Control": requestedPath === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
      "Content-Length": String(stat.size),
      "Content-Type": CONTENT_TYPES[path.extname(asset).toLowerCase()] ?? "application/octet-stream",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    if (requestedPath === "index.html") {
      headers.set(
        "Content-Security-Policy",
        "default-src 'self'; connect-src 'self'; font-src 'self' data:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; worker-src 'none'",
      );
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("X-Frame-Options", "DENY");
    }
    if (context.req.method === "HEAD") return new Response(null, { status: 200, headers });

    const body = Readable.toWeb(createReadStream(asset)) as ReadableStream<Uint8Array>;
    return new Response(body, { status: 200, headers });
  });
}
