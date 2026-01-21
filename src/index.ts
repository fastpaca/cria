/**
 * Cria - fluent DSL for prompt composition.
 *
 * @example
 * ```ts
 * import { cria } from "@fastpaca/cria";
 *
 * const result = await cria
 *   .prompt(provider)
 *   .system("You are a helpful assistant.")
 *   .truncate(conversationHistory, { budget: 20000, from: "start", priority: 2 })
 *   .omit(optionalContext, { priority: 3 })
 *   .render({ budget: 128000 });
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
  history,
  historyLayout,
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
export { ListMessageCodec, MessageCodec } from "./message-codec";
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
  HistoryInput,
  HistoryLayout,
  HistoryProvider,
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
  ProviderToolIO,
  ReasoningPart,
  ScopeChildren,
  Strategy,
  StrategyInput,
  StrategyResult,
  TextPart,
  ToolCallPart,
  ToolIOForProvider,
  ToolResultPart,
} from "./types";
export { FitError, ModelProvider } from "./types";
