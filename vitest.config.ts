import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const srcPath = resolve(__dirname, "src");

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@fastpaca/cria/jsx",
  },
  resolve: {
    alias: {
      "@fastpaca/cria": srcPath,
      "@fastpaca/cria/jsx": resolve(srcPath, "jsx/index.ts"),
      "@fastpaca/cria/jsx/jsx-runtime": resolve(srcPath, "jsx/jsx-runtime.ts"),
      "@fastpaca/cria/jsx/jsx-dev-runtime": resolve(
        srcPath,
        "jsx/jsx-dev-runtime.ts"
      ),
    },
  },
});
