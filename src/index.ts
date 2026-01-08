/**
 * Cria - JSX-based prompt renderer with automatic token budget fitting.
 *
 * @example
 * ```tsx
 * import { render, Region, Truncate, Omit } from "@fastpaca/cria";
 *
 * const prompt = (
 *   <Region priority={0}>
 *     You are a helpful assistant.
 *     <Truncate budget={20000} from="start" priority={2}>
 *       {conversationHistory}
 *     </Truncate>
 *     <Omit priority={3}>
 *       {optionalContext}
 *     </Omit>
 *   </Region>
 * );
 *
 * const result = await render(prompt, { tokenizer, budget: 128000 });
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
  type SnapshotDiff,
  type SnapshotNode,
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
