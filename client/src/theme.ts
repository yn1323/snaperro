import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        // Primary accent - Emerald green
        accent: {
          50: { value: "#ecfdf5" },
          100: { value: "#d1fae5" },
          200: { value: "#a7f3d0" },
          300: { value: "#6ee7b7" },
          400: { value: "#34d399" },
          500: { value: "#10b981" },
          600: { value: "#059669" },
          700: { value: "#047857" },
          800: { value: "#065f46" },
          900: { value: "#064e3b" },
        },
        // Semantic colors
        recording: {
          50: { value: "#fef2f2" },
          100: { value: "#fee2e2" },
          400: { value: "#f87171" },
          500: { value: "#ef4444" },
          600: { value: "#dc2626" },
        },
        mock: {
          50: { value: "#eff6ff" },
          100: { value: "#dbeafe" },
          400: { value: "#60a5fa" },
          500: { value: "#3b82f6" },
          600: { value: "#2563eb" },
        },
        smart: {
          50: { value: "#fffbeb" },
          100: { value: "#fef3c7" },
          400: { value: "#fbbf24" },
          500: { value: "#f59e0b" },
          600: { value: "#d97706" },
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
        "app.bg": { value: "{colors.gray.50}" },
        "app.header.bg": { value: "{colors.gray.900}" },
        "app.header.text": { value: "{colors.white}" },
        "app.header.accent": { value: "{colors.accent.500}" },
        "app.pane.bg": { value: "{colors.white}" },
        "app.pane.header": { value: "{colors.gray.100}" },
        "app.border": { value: "{colors.gray.200}" },
        "app.text": { value: "{colors.gray.700}" },
        "app.text.muted": { value: "{colors.gray.500}" },
        "app.selected.bg": { value: "{colors.accent.50}" },
        "app.selected.border": { value: "{colors.accent.500}" },
        "app.hover.bg": { value: "{colors.gray.100}" },
        "app.editor.bg": { value: "{colors.gray.50}" },
        "app.editor.text": { value: "{colors.gray.700}" },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
