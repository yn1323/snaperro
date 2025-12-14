import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        // Primary accent - Teal
        accent: {
          50: { value: "#f0fdfa" },
          100: { value: "#ccfbf1" },
          200: { value: "#99f6e4" },
          300: { value: "#5eead4" },
          400: { value: "#2dd4bf" },
          500: { value: "#14b8a6" },
          600: { value: "#0d9488" },
          700: { value: "#0f766e" },
          800: { value: "#115e59" },
          900: { value: "#134e4a" },
        },
        // Recording state - Red
        recording: {
          50: { value: "#fef2f2" },
          100: { value: "#fee2e2" },
          400: { value: "#f87171" },
          500: { value: "#ef4444" },
          600: { value: "#dc2626" },
        },
        // Mock state - Blue
        mock: {
          50: { value: "#eff6ff" },
          100: { value: "#dbeafe" },
          400: { value: "#60a5fa" },
          500: { value: "#3b82f6" },
          600: { value: "#2563eb" },
        },
      },
      fonts: {
        heading: { value: "'Inter', 'Noto Sans JP', sans-serif" },
        body: { value: "'Inter', 'Noto Sans JP', sans-serif" },
        mono: { value: "'JetBrains Mono', monospace" },
      },
    },
    semanticTokens: {
      colors: {
        // App-specific semantic tokens
        "app.bg": { value: "{colors.gray.100}" },
        "app.header.bg": { value: "{colors.white}" },
        "app.panel.bg": { value: "{colors.white}" },
        "app.border": { value: "{colors.gray.200}" },
        "app.text": { value: "{colors.gray.700}" },
        "app.text.muted": { value: "{colors.gray.500}" },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
