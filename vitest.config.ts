import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const srcPath = resolve(import.meta.dirname, "src");

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@fastpaca/cria": srcPath,
    },
  },
});
