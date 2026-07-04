import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/client"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/compare": "http://localhost:8787",
      "/voice": "http://localhost:8787",
      "/nodeagents": "http://localhost:8787",
      "/health": "http://localhost:8787",
      // Only proxy the live API sub-paths — NOT a blanket "/live", which would
      // also swallow client module requests for src/client/live/*.tsx in dev.
      "^/live/(rooms|audio)": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
