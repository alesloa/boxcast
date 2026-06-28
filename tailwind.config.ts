import type { Config } from "tailwindcss";

// Tokens copied verbatim from _plans/ui-mockup.html — the look is locked.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Theme-aware tokens — values resolve from CSS variables defined in
        // index.css (dark by default, overridden under [data-theme="light"]).
        bg: "var(--c-bg)",
        sidebar: "var(--c-sidebar)",
        elev: "var(--c-elev)",
        hover: "var(--c-hover)",
        border: "var(--c-border)",
        "border-strong": "var(--c-border-strong)",
        text: "var(--c-text)",
        dim: "var(--c-dim)",
        faint: "var(--c-faint)",
        green: "var(--c-green)",
        "green-bg": "var(--c-green-bg)",
        "green-bd": "var(--c-green-bd)",
        red: "var(--c-red)",
        yellow: "var(--c-yellow)",
        blue: "var(--c-blue)",
        // structural surfaces (also theme-aware)
        active: "var(--c-active)",
        "active-text": "var(--c-active-text)",
        track: "var(--c-track)",
        surface2: "var(--c-surface2)",
        statusbar: "var(--c-statusbar)",
        "statusbar-text": "var(--c-statusbar-text)",
        monogram: "var(--c-monogram)",
        // window control accents (identical in both themes)
        "mac-red": "#ff5f57",
        "mac-yellow": "#febc2e",
        "mac-green": "#28c840",
        "win-close": "#e81123",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "SF Pro Display",
          "SF Pro Text",
          "Segoe UI",
          "system-ui",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        win: "14px",
        card: "10px",
        ctl: "7px",
      },
      fontSize: {
        "2xs": "10.5px",
      },
      keyframes: {
        pulse: {
          "0%": { boxShadow: "0 0 0 0 rgba(240,99,92,.6)" },
          "70%": { boxShadow: "0 0 0 8px rgba(240,99,92,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(240,99,92,0)" },
        },
        eq: {
          "0%,100%": { transform: "scaleY(.5)" },
          "50%": { transform: "scaleY(1)" },
        },
      },
      animation: {
        pulse: "pulse 1.8s infinite",
        eq: "eq 1s infinite ease-in-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
