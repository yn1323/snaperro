import type { ApiConfig, SnaperroConfig } from "../types/config.js";

/**
 * Built-in API configurations.
 * These are always available without user configuration.
 * Used by demo page and for learning purposes.
 */
export const BUILTIN_APIS: Record<string, ApiConfig> = {
  jsonPlaceholder: {
    name: "JSON Placeholder",
    target: "https://jsonplaceholder.typicode.com",
    routes: ["/users", "/users/:id", "/posts", "/posts/:id", "/posts/:id/comments", "/comments"],
  },
};

/**
 * Merge built-in APIs with user config.
 * User config takes precedence (can override built-in).
 */
export function mergeWithBuiltinApis(config: SnaperroConfig): SnaperroConfig {
  return {
    ...config,
    apis: {
      ...BUILTIN_APIS,
      ...config.apis,
    },
  };
}
