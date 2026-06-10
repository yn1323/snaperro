const SENSITIVE_QUERY_KEYS = [
  "key",
  "secret",
  "token",
  "authorization",
  "password",
  "passwd",
  "credential",
  "signature",
];
const DETAIL_KEYS = [
  "code",
  "errno",
  "syscall",
  "hostname",
  "host",
  "port",
  "address",
  "localAddress",
  "localPort",
  "remoteAddress",
  "remotePort",
  "remoteFamily",
  "timeout",
  "reason",
] as const;
const SOCKET_DETAIL_KEYS = [
  "localAddress",
  "localPort",
  "remoteAddress",
  "remotePort",
  "remoteFamily",
  "bytesWritten",
  "bytesRead",
] as const;
const MAX_NESTED_ERRORS = 5;
const MAX_DEPTH = 4;

interface FetchFailureLogOptions {
  operation: "Proxy" | "Record";
  method: string;
  requestPath: string;
  targetUrl: string;
  upstreamProxyEnabled: boolean;
  error: unknown;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatFetchFailureLog(options: FetchFailureLogOptions): string {
  const lines = [
    `${options.operation} failed: ${getErrorMessage(options.error)}`,
    `  request: ${options.method} ${maskRequestPath(options.requestPath)}`,
    `  target: ${maskUrl(options.targetUrl)}`,
    `  upstreamProxy: ${options.upstreamProxyEnabled ? "enabled" : "disabled"}`,
  ];

  lines.push(...formatFetchFailureDetails(options.error).map((line) => `  ${line}`));

  return lines.join("\n");
}

export function formatFetchFailureDetails(error: unknown): string[] {
  const seen = new WeakSet<object>();
  return formatErrorNode(error, "error", 0, seen);
}

function formatErrorNode(error: unknown, label: string, depth: number, seen: WeakSet<object>): string[] {
  if (depth > MAX_DEPTH) {
    return [`${label}: <max depth reached>`];
  }

  const lines = [`${label}: ${formatErrorTitle(error)}`];

  if (isObject(error)) {
    if (seen.has(error)) {
      return [`${label}: <circular error>`];
    }
    seen.add(error);

    const details = DETAIL_KEYS.flatMap((key) => {
      const value = error[key];
      return value === undefined ? [] : [`${key}=${String(value)}`];
    });
    if (details.length > 0) {
      lines.push(`${label} details: ${details.join(", ")}`);
    }

    const socketDetails = formatObjectDetails(error.socket, SOCKET_DETAIL_KEYS);
    if (socketDetails.length > 0) {
      lines.push(`${label} socket: ${socketDetails.join(", ")}`);
    }

    const nestedErrors = getNestedErrors(error);
    if (nestedErrors.length > 0) {
      lines.push(`${label} aggregate: ${nestedErrors.length} error(s)`);
      for (const [index, nestedError] of nestedErrors.slice(0, MAX_NESTED_ERRORS).entries()) {
        lines.push(...formatErrorNode(nestedError, `${label}.errors[${index}]`, depth + 1, seen));
      }
      if (nestedErrors.length > MAX_NESTED_ERRORS) {
        lines.push(`${label}.errors: ${nestedErrors.length - MAX_NESTED_ERRORS} more error(s) omitted`);
      }
    }

    const cause = error.cause;
    if (cause !== undefined) {
      lines.push(...formatErrorNode(cause, "cause", depth + 1, seen));
    }
  }

  return lines;
}

function formatObjectDetails<T extends readonly string[]>(value: unknown, keys: T): string[] {
  if (!isObject(value)) {
    return [];
  }

  return keys.flatMap((key) => {
    const detailValue = value[key];
    return detailValue === undefined ? [] : [`${key}=${String(detailValue)}`];
  });
}

function formatErrorTitle(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (isObject(error)) {
    const name = typeof error.name === "string" ? error.name : undefined;
    const message = typeof error.message === "string" ? error.message : undefined;
    if (name || message) {
      return [name, message].filter(Boolean).join(": ");
    }
  }

  return String(error);
}

function getNestedErrors(error: Record<string, unknown>): unknown[] {
  if (error instanceof AggregateError) {
    return error.errors;
  }

  return Array.isArray(error.errors) ? error.errors : [];
}

function maskUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password) {
      url.username = url.username ? "***" : "";
      url.password = url.password ? "***" : "";
    }

    for (const key of new Set(url.searchParams.keys())) {
      if (isSensitiveKey(key)) {
        const values = url.searchParams.getAll(key);
        url.searchParams.delete(key);
        for (const value of values) {
          url.searchParams.append(key, maskValue(value));
        }
      }
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}

function maskRequestPath(requestPath: string): string {
  try {
    const url = new URL(requestPath, "http://snaperro.local");
    return maskUrl(url.toString()).replace("http://snaperro.local", "");
  } catch {
    return requestPath;
  }
}

function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return SENSITIVE_QUERY_KEYS.some((sensitiveKey) => lowerKey.includes(sensitiveKey));
}

function maskValue(value: string): string {
  if (value.length <= 4) {
    return "****";
  }

  return `${value.slice(0, 4)}${"*".repeat(Math.min(value.length - 4, 10))}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
