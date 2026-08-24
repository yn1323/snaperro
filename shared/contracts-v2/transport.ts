export const V2_CONTROL_BASE_PATH = "/__snaperro__/v2" as const;
export const DOWNLOAD_CAPABILITY_BASE_PATH = "/__snaperro__/downloads" as const;
/** Shared request/response JSON ceiling for the control server and browser client. */
export const MAX_CONTROL_JSON_BYTES = 8 * 1024 * 1024;

/** Relative paths are used by Hono sub-apps and clients with a custom base URL. */
export const V2_RELATIVE_PATHS = {
  commands: "/commands",
  queries: "/queries",
  events: "/events",
  bodies: "/bodies",
  folderImports: "/transfers/imports",
  recordingImports: "/transfers/recording-imports",
} as const;

/** Canonical public paths mounted by the v2 runtime. */
export const V2_ROUTE_PATHS = {
  base: V2_CONTROL_BASE_PATH,
  commands: `${V2_CONTROL_BASE_PATH}${V2_RELATIVE_PATHS.commands}`,
  queries: `${V2_CONTROL_BASE_PATH}${V2_RELATIVE_PATHS.queries}`,
  events: `${V2_CONTROL_BASE_PATH}${V2_RELATIVE_PATHS.events}`,
  bodies: `${V2_CONTROL_BASE_PATH}${V2_RELATIVE_PATHS.bodies}`,
  folderImports: `${V2_CONTROL_BASE_PATH}${V2_RELATIVE_PATHS.folderImports}`,
  recordingImports: `${V2_CONTROL_BASE_PATH}${V2_RELATIVE_PATHS.recordingImports}`,
  downloads: DOWNLOAD_CAPABILITY_BASE_PATH,
} as const;
