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
 *     <Truncate budget={20000} direction="start" priority={2}>
 *       {conversationHistory}
 *     </Truncate>
 *     <Omit priority={3}>
 *       {optionalContext}
 *     </Omit>
 *   </Region>
 * );
 *
 * const result = render(prompt, { tokenizer, budget: 128000 });
 * ```
 *
 * @packageDocumentation
 */

export type {
  StoredSummary,
  Summarizer,
  SummarizerContext,
} from "./components";
export {
  Last,
  Message,
  Omit,
  Reasoning,
  Region,
  Summary,
  ToolCall,
  ToolResult,
  Truncate,
} from "./components";
export type {
  KVMemory,
  MemoryEntry,
  VectorMemory,
  VectorSearchOptions,
  VectorSearchResult,
} from "./memory";
// LLM Memory
export { InMemoryStore } from "./memory";
export type { RenderOptions } from "./render";
export { render } from "./render";
export { markdownRenderer } from "./renderers/markdown";
export type {
  MaybePromise,
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
export { FitError } from "./types";
