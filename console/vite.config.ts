import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5174,
    proxy: {
      "/console": { target: "http://localhost:3000", changeOrigin: true },
      "/ingest": { target: "http://localhost:3000", changeOrigin: true },
      "/sdk": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
