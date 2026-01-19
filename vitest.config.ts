import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const srcPath = resolve(__dirname, "src");

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@fastpaca/cria": srcPath,
    },
  },
});
