export * from "../shared/contracts-v2/index.js";
export type {
  CompiledSnaperroConfigV2,
  SnaperroConfigV2Input as SnaperroConfig,
  V2ApiConfig as ApiConfig,
} from "./v2/config/config.js";
export {
  BUILTIN_APIS_V2,
  defineConfigV2,
  defineConfigV2 as defineConfig,
  SnaperroConfigV2Schema,
  V2ApiConfigSchema,
} from "./v2/config/config.js";
export { loadConfigV2 } from "./v2/config/loader.js";
export {
  createV2App,
  createV2Server,
  ImmutableConfigChangeError,
  SnaperroV2Server,
} from "./v2/server/index.js";
export { VERSION } from "./version.js";
