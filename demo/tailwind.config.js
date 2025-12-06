/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "#0a0a0b",
          secondary: "#141416",
          tertiary: "#1c1c1f",
        },
        accent: {
          cyan: "#22d3ee",
          red: "#f87171",
          green: "#4ade80",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
