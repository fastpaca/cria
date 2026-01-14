/**
 * Cria - fluent DSL for prompt composition.
 *
 * @example
 * ```ts
 * import { cria } from "@fastpaca/cria";
 *
 * const result = await cria
 *   .prompt()
 *   .system("You are a helpful assistant.")
 *   .truncate(conversationHistory, { budget: 20000, from: "start", priority: 2 })
 *   .omit(optionalContext, { priority: 3 })
 *   .render({ tokenizer, budget: 128000 });
 * ```
 *
 * @packageDocumentation
 */

export type {
  ResultFormatter,
  StoredSummary,
  Summarizer,
  SummarizerContext,
} from "./components";
export {
  CodeBlock,
  Examples,
  Last,
  Message,
  Omit,
  Reasoning,
  Region,
  Separator,
  Summary,
  ToolCall,
  ToolResult,
  Truncate,
  VectorSearch,
} from "./components";
// DSL
export type { Prompt } from "./dsl";
export { cria, merge, PromptBuilder, prompt } from "./dsl";
export { createOtelRenderHooks } from "./instrumentation/otel";
export type {
  KVMemory,
  MemoryEntry,
  VectorMemory,
  VectorSearchOptions,
  VectorSearchResult,
} from "./memory";
// LLM Memory
export { InMemoryStore } from "./memory";
export type {
  FitCompleteEvent,
  FitErrorEvent,
  FitIterationEvent,
  FitStartEvent,
  RenderHooks,
  RenderOptions,
  StrategyAppliedEvent,
} from "./render";
export { render } from "./render";
export { markdownRenderer } from "./renderers/markdown";
export {
  createSnapshot,
  createSnapshotHooks,
  diffSnapshots,
  type Snapshot,
  type SnapshotChild,
  type SnapshotDiff,
  type SnapshotElement,
} from "./snapshot";
export type {
  CompletionMessage,
  CompletionRequest,
  CompletionResult,
  CriaContext,
  JsonValue,
  MaybePromise,
  ModelProvider,
  PromptChild,
  PromptChildren,
  PromptElement,
  PromptKind,
  PromptNodeKind,
  PromptRenderer,
  PromptRole,
  Strategy,
  StrategyInput,
  StrategyResult,
  Tokenizer,
} from "./types";
export {
  FitError,
  JsonValueSchema,
  PromptChildrenSchema,
  PromptChildSchema,
  PromptElementSchema,
  PromptKindSchema,
  PromptRoleSchema,
} from "./types";
