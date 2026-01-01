import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.tsx"],
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@fastpaca/cria",
  },
  resolve: {
    alias: {
      "@fastpaca/cria": resolve(__dirname, "src"),
    },
  },
});
