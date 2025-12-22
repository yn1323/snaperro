/**
 * Request processing utilities
 * Common functions for handling HTTP requests across handlers
 */

/**
 * Default headers to skip when copying request headers
 */
export const DEFAULT_SKIP_HEADERS = ["host", "connection", "if-none-match", "if-modified-since"];

/**
 * Check if the Content-Type header indicates JSON
 */
export function isJsonContentType(headers: Headers): boolean {
  const contentType = headers.get("content-type") || "";
  return contentType.includes("application/json");
}

/**
 * Parse URL search parameters into a record
 * Handles multiple values for the same key as arrays
 */
export function parseQueryParams(url: URL): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams.entries()) {
    const existing = params[key];
    if (existing) {
      params[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      params[key] = value;
    }
  }
  return params;
}

/**
 * Parse request body from a Request object
 * - Returns null for GET/HEAD methods (no body expected)
 * - Attempts JSON parse by default, falls back to raw text
 *
 * @param method - HTTP method
 * @param getText - Function to get request body as text
 * @param parseJson - Whether to attempt JSON parsing (default: true)
 */
export async function parseRequestBody(
  method: string,
  getText: () => Promise<string>,
  parseJson = true,
): Promise<unknown | null> {
  // GET/HEAD requests don't have a body
  if (method === "GET" || method === "HEAD") {
    return null;
  }

  const text = await getText();
  if (!text) {
    return null;
  }

  if (!parseJson) {
    return text;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Copy request headers, excluding specified headers and limiting Accept-Encoding
 *
 * @param sourceHeaders - Original request headers
 * @param additionalHeaders - Headers to add/override from config
 */
export function copyRequestHeaders(sourceHeaders: Headers, additionalHeaders?: Record<string, string>): Headers {
  const headers = new Headers();

  // Copy headers (excluding cache-related and connection headers)
  for (const [key, value] of sourceHeaders.entries()) {
    if (!DEFAULT_SKIP_HEADERS.includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  // Limit Accept-Encoding (Node.js doesn't support zstd/br)
  headers.set("accept-encoding", "gzip, deflate");

  // Add headers from config
  if (additionalHeaders) {
    for (const [key, value] of Object.entries(additionalHeaders)) {
      headers.set(key, value);
    }
  }

  return headers;
}
