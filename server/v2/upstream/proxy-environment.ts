export type UpstreamProxySource = "config" | "HTTPS_PROXY" | "HTTP_PROXY" | "https_proxy" | "http_proxy";

export interface ResolvedUpstreamProxy {
  url: string;
  source: UpstreamProxySource;
}

export type ProxyEnvironment = Readonly<Record<string, string | undefined>>;

const ENVIRONMENT_PRIORITY = ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"] as const;

function parseProxyUrl(value: string, source: UpstreamProxySource): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`Invalid upstream proxy URL from ${source}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError(`Unsupported upstream proxy protocol from ${source}`);
  }
  return parsed.toString();
}

/** Resolves the legacy-compatible proxy precedence without exposing credentials. */
export function resolveUpstreamProxy(
  configuredUrl: string | undefined,
  environment: ProxyEnvironment = process.env,
): ResolvedUpstreamProxy | undefined {
  if (configuredUrl) return { url: parseProxyUrl(configuredUrl, "config"), source: "config" };

  for (const name of ENVIRONMENT_PRIORITY) {
    const value = environment[name]?.trim();
    if (value) return { url: parseProxyUrl(value, name), source: name };
  }
  return undefined;
}

export function maskProxyUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "[invalid proxy URL]";
  }
}
