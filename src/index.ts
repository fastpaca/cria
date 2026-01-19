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
 *   .render({ budget: 128000, provider });
 * ```
 *
 * @packageDocumentation
 */

// DSL - primary API
export type {
  BuilderChild,
  Prompt,
  ResultFormatter,
  ScopeContent,
  StoredSummary,
  Summarizer,
  SummarizerContext,
  TextInput,
} from "./dsl";
export {
  BuilderBase,
  c,
  cria,
  MessageBuilder,
  merge,
  PromptBuilder,
  prompt,
} from "./dsl";

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
export type {
  CriaContext,
  MaybePromise,
  MessageChildren,
  PromptLayout,
  PromptMessage,
  PromptMessageNode,
  PromptNode,
  PromptPart,
  PromptRole,
  PromptScope,
  PromptTree,
  ReasoningPart,
  ScopeChildren,
  Strategy,
  StrategyInput,
  StrategyResult,
  TextPart,
  ToolCallPart,
  ToolResultPart,
} from "./types";
export { FitError, ModelProvider, PromptRenderer } from "./types";
