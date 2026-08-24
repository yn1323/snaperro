import path from "node:path";
import { z } from "zod/v4";
import { HttpHeaderNameSchema, HttpHeaderValueSchema } from "../../../shared/contracts-v2/primitives.js";
import { RouteTable } from "../traffic/route-table.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const FORBIDDEN_CONFIGURED_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function httpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

const HttpUrlSchema = z
  .string()
  .url()
  .refine((value) => httpUrl(value) !== null, "Only HTTP(S) URLs are supported");

const UpstreamTargetSchema = HttpUrlSchema.superRefine((value, context) => {
  const parsed = httpUrl(value);
  if (!parsed) return;
  if (parsed.username || parsed.password) {
    context.addIssue({ code: "custom", message: "Upstream targets cannot contain credentials" });
  }
  if (value.includes("?")) {
    context.addIssue({ code: "custom", message: "Upstream targets cannot contain a query" });
  }
  if (value.includes("#")) {
    context.addIssue({ code: "custom", message: "Upstream targets cannot contain a fragment" });
  }
});

const AllowedOriginSchema = HttpUrlSchema.superRefine((value, context) => {
  const parsed = httpUrl(value);
  if (parsed?.username || parsed?.password) {
    context.addIssue({ code: "custom", message: "Allowed origins cannot contain credentials" });
  }
}).transform((value) => {
  const origin = new URL(value).origin;
  if (origin === "null") throw new Error("Allowed origin must have a tuple origin");
  return origin;
});

const ConfiguredHeadersSchema = z
  .record(HttpHeaderNameSchema, HttpHeaderValueSchema)
  .superRefine((headers, context) => {
    const seen = new Set<string>();
    for (const name of Object.keys(headers)) {
      const normalized = name.toLowerCase();
      if (seen.has(normalized)) {
        context.addIssue({ code: "custom", path: [name], message: "Configured header names must be unique" });
      }
      if (FORBIDDEN_CONFIGURED_HEADERS.has(normalized)) {
        context.addIssue({ code: "custom", path: [name], message: "Configured header is controlled by HTTP framing" });
      }
      seen.add(normalized);
    }
  });

const HeaderMaskSchema = z.array(HttpHeaderNameSchema).superRefine((names, context) => {
  const seen = new Set<string>();
  for (const [index, name] of names.entries()) {
    const normalized = name.toLowerCase();
    if (seen.has(normalized)) {
      context.addIssue({ code: "custom", path: [index], message: "Masked header names must be unique" });
    }
    seen.add(normalized);
  }
});

export const V2ModeSchema = z.enum(["proxy", "record", "mock", "smart"]);
export type V2Mode = z.infer<typeof V2ModeSchema>;

export const V2MockFallbackSchema = z.enum(["404", "proxy", "proxy&record"]);
export type V2MockFallback = z.infer<typeof V2MockFallbackSchema>;

export const V2ApiConfigSchema = z
  .object({
    name: z.string().trim().min(1),
    target: UpstreamTargetSchema,
    routes: z.array(z.string().trim().min(1)).min(1),
    headers: ConfiguredHeadersSchema.default({}),
    maskRequestHeaders: HeaderMaskSchema.default([]),
  })
  .strict();
export type V2ApiConfig = z.infer<typeof V2ApiConfigSchema>;

/** Built-in API set. User entries with the same key replace a built-in API. */
export const BUILTIN_APIS_V2: Readonly<Record<string, V2ApiConfig>> = Object.freeze({
  jsonPlaceholder: {
    name: "JSON Placeholder",
    target: "https://jsonplaceholder.typicode.com",
    routes: ["/users", "/users/:id", "/posts", "/posts/:id", "/posts/:id/comments", "/comments"],
    headers: {},
    maskRequestHeaders: [],
  },
});

const ServerConfigSchema = z
  .object({
    host: z.string().trim().min(1).default("127.0.0.1"),
    port: z.number().int().min(1).max(65535).default(3333),
    openBrowser: z.boolean().default(true),
    allowedOrigins: z.array(AllowedOriginSchema).default([]),
    controlToken: z.string().min(16).optional(),
    shutdownTimeoutMs: z.number().int().min(100).max(60_000).default(5_000),
  })
  .strict();

const DEFAULT_SERVER_CONFIG: z.output<typeof ServerConfigSchema> = {
  host: "127.0.0.1",
  port: 3333,
  openBrowser: true,
  allowedOrigins: [],
  shutdownTimeoutMs: 5_000,
};

const StorageConfigSchema = z
  .object({
    root: z.string().trim().min(1).default(".snaperro/v2"),
    maxImportBytes: z
      .number()
      .int()
      .safe()
      .positive()
      .default(512 * 1024 * 1024),
  })
  .strict();

const DEFAULT_STORAGE_CONFIG: z.output<typeof StorageConfigSchema> = {
  root: ".snaperro/v2",
  maxImportBytes: 512 * 1024 * 1024,
};

const RecordingConfigSchema = z
  .object({
    completeOnClientDisconnect: z.boolean().default(true),
    maxRequestBodyBytes: z
      .number()
      .int()
      .safe()
      .positive()
      .default(256 * 1024 * 1024),
    maskRequestHeaders: HeaderMaskSchema.default([]),
  })
  .strict();

const DEFAULT_RECORDING_CONFIG: z.output<typeof RecordingConfigSchema> = {
  completeOnClientDisconnect: true,
  maxRequestBodyBytes: 256 * 1024 * 1024,
  maskRequestHeaders: [],
};

const ProxyConfigSchema = z
  .object({
    url: HttpUrlSchema.optional(),
  })
  .strict();

const MockConfigSchema = z
  .object({
    fallback: V2MockFallbackSchema.default("404"),
  })
  .strict();

const DEFAULT_MOCK_CONFIG: z.output<typeof MockConfigSchema> = { fallback: "404" };

export const SnaperroConfigV2Schema = z
  .object({
    configVersion: z.literal(2),
    server: ServerConfigSchema.default(DEFAULT_SERVER_CONFIG),
    storage: StorageConfigSchema.default(DEFAULT_STORAGE_CONFIG),
    recording: RecordingConfigSchema.default(DEFAULT_RECORDING_CONFIG),
    proxy: ProxyConfigSchema.default({}),
    mock: MockConfigSchema.default(DEFAULT_MOCK_CONFIG),
    apis: z.record(z.string().min(1), V2ApiConfigSchema),
  })
  .strict()
  .superRefine((config, context) => {
    if (!LOOPBACK_HOSTS.has(config.server.host) && !config.server.controlToken) {
      context.addIssue({
        code: "custom",
        path: ["server", "controlToken"],
        message: "controlToken is required when the server binds to a non-loopback host",
      });
    }
    const origins = new Set<string>();
    for (const [index, origin] of config.server.allowedOrigins.entries()) {
      if (origins.has(origin)) {
        context.addIssue({
          code: "custom",
          path: ["server", "allowedOrigins", index],
          message: "Allowed origins must be unique after normalization",
        });
      }
      origins.add(origin);
    }
  });

export type SnaperroConfigV2Input = z.input<typeof SnaperroConfigV2Schema>;
export type SnaperroConfigV2 = z.output<typeof SnaperroConfigV2Schema>;

export interface CompiledSnaperroConfigV2 extends Omit<SnaperroConfigV2, "storage"> {
  storage: SnaperroConfigV2["storage"] & { root: string };
  configDirectory: string;
  routeTable: RouteTable<V2ApiConfig>;
}

export function defineConfigV2(config: SnaperroConfigV2Input): SnaperroConfigV2 {
  return SnaperroConfigV2Schema.parse(config);
}

export function compileConfigV2(config: SnaperroConfigV2Input, configFilePath: string): CompiledSnaperroConfigV2 {
  const parsed = SnaperroConfigV2Schema.parse(config);
  const configDirectory = path.dirname(path.resolve(configFilePath));
  const apis = { ...BUILTIN_APIS_V2, ...parsed.apis };

  return {
    ...parsed,
    apis,
    storage: {
      ...parsed.storage,
      root: path.resolve(configDirectory, parsed.storage.root),
    },
    configDirectory,
    routeTable: new RouteTable(apis),
  };
}
