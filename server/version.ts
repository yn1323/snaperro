declare const __SNAPERRO_VERSION__: string;

/** Package version injected by the production build. */
export const VERSION = typeof __SNAPERRO_VERSION__ === "string" ? __SNAPERRO_VERSION__ : "0.0.0-dev";
