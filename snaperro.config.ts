import { defineConfig } from "snaperro";

export default defineConfig({
  configVersion: 2,
  server: {
    host: "127.0.0.1",
    port: 3333,
  },
  storage: {
    root: ".snaperro/v2",
  },
  recording: {
    maskRequestHeaders: ["cookie"],
  },
  mock: {
    fallback: "404",
  },

  // An empty map enables the bundled JSON Placeholder demo API. Add your own
  // APIs here to make explicit routes authoritative.
  apis: {},
});
