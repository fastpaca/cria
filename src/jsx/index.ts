/**
 * Optional JSX surface. Prefer the fluent DSL from `@fastpaca/cria` as the default.
 */
// biome-ignore lint/performance/noBarrelFile: JSX entrypoint intentionally re-exports components
export * from "../components";
export { Fragment, jsx, jsxs } from "./jsx-runtime";
