import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(__dirname),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      allow: [resolve(__dirname, "..")],
    },
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "../src/shared"),
    },
  },
});
