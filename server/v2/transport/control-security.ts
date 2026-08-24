import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export interface ControlSecurityOptions {
  /** The origin used by the bundled control UI. Never derive this from Host. */
  serverOrigin: string;
  allowedOrigins: readonly string[];
  controlToken?: string;
}

function isAllowedOrigin(origin: string, allowedOrigins: ReadonlySet<string>): boolean {
  return allowedOrigins.has(origin);
}

function readBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const [scheme, token] = authorization.split(" ", 2);
  return scheme?.toLowerCase() === "bearer" && token ? token : undefined;
}

function tokensMatch(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function controlSecurity(options: ControlSecurityOptions): MiddlewareHandler {
  const allowedOrigins = new Set(
    [options.serverOrigin, ...options.allowedOrigins].map((value) => new URL(value).origin),
  );

  return async (context, next) => {
    const origin = context.req.header("origin");
    if (origin && !isAllowedOrigin(origin, allowedOrigins)) {
      return context.json(
        { error: { code: "ORIGIN_FORBIDDEN", message: "Origin is not allowed", retryable: false } },
        403,
      );
    }

    if (origin) {
      context.header("Access-Control-Allow-Origin", origin);
      context.header("Vary", "Origin");
      context.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      context.header("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match");
      context.header(
        "Access-Control-Expose-Headers",
        "Content-Disposition, Content-Length, ETag, Retry-After, X-Snaperro-Content-Encoding",
      );
    }

    if (context.req.method === "OPTIONS") {
      return context.body(null, 204);
    }

    if (options.controlToken) {
      const token = readBearerToken(context.req.header("authorization"));
      if (!tokensMatch(token, options.controlToken)) {
        context.header("WWW-Authenticate", "Bearer");
        return context.json(
          { error: { code: "UNAUTHORIZED", message: "A valid control token is required", retryable: false } },
          401,
        );
      }
    }

    await next();
  };
}
