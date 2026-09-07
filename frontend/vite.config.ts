import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Trailing slash matters: "/api" as a prefix would also swallow
      // frontend routes like "/api-docs" and proxy them to the backend.
      "/api/": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/console": { target: "http://localhost:3000", changeOrigin: true },
      "/ingest": { target: "http://localhost:3000", changeOrigin: true },
      "/sdk": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
