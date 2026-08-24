const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

import type { HeaderFields } from "../../../shared/contracts-v2/primitives.js";

export function buildUpstreamUrl(target: string, incomingUrl: string): URL {
  const upstream = new URL(target);
  const incoming = new URL(incomingUrl);
  const basePath = upstream.pathname === "/" ? "" : upstream.pathname.replace(/\/$/u, "");
  upstream.pathname = `${basePath}${incoming.pathname.startsWith("/") ? incoming.pathname : `/${incoming.pathname}`}`;
  upstream.search = incoming.search;
  upstream.hash = "";
  return upstream;
}

function connectionTokens(headers: Headers): Set<string> {
  return new Set(
    (headers.get("connection") ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function forwardRequestHeaders(source: Headers, additions: Readonly<Record<string, string>> = {}): Headers {
  const result = new Headers();
  const excluded = connectionTokens(source);
  excluded.add("host");
  excluded.add("content-length");
  for (const header of HOP_BY_HOP_HEADERS) excluded.add(header);

  for (const [name, value] of source) {
    if (!excluded.has(name.toLowerCase())) result.append(name, value);
  }
  for (const [name, value] of Object.entries(additions)) result.set(name, value);
  return result;
}

export function forwardResponseHeaders(source: Headers): Headers {
  const result = new Headers();
  const excluded = connectionTokens(source);
  for (const header of HOP_BY_HOP_HEADERS) excluded.add(header);

  for (const [name, value] of source) {
    if (!excluded.has(name.toLowerCase())) result.append(name, value);
  }
  return result;
}

export function sanitizeResponseHeaderFields(fields: HeaderFields): HeaderFields {
  const connectionValues = fields
    .filter(([name]) => name.toLowerCase() === "connection")
    .flatMap(([, value]) => value.split(","));
  const excluded = new Set(HOP_BY_HOP_HEADERS);
  for (const value of connectionValues) {
    const normalized = value.trim().toLowerCase();
    if (normalized) excluded.add(normalized);
  }
  return fields.filter(([name]) => !excluded.has(name.toLowerCase()));
}
