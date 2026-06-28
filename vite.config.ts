import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port it can point its webview at (devUrl in
// tauri.conf.json). We use an uncommon, non-default port and strictPort:true so
// it fails loudly instead of silently shadowing another dev server. The
// load-bearing "random verified-free port" rule is applied to the in-process
// HLS proxy (chosen at runtime in Rust), which is what could collide with other
// running apps — not this dev-only Vite port.
const DEV_PORT = 5317;

// @ts-expect-error process is provided by Node at config-eval time
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: DEV_PORT,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: DEV_PORT + 1 }
      : undefined,
    watch: {
      // tauri's rust sources are watched by tauri itself
      ignored: ["**/src-tauri/**"],
    },
  },
  // produce a relative-asset build so the bundled webview can load it
  base: "./",
  build: {
    target: "es2021",
    sourcemap: false,
    outDir: "dist",
    emptyOutDir: true,
  },
});
