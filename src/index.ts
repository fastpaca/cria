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

// biome-ignore lint/performance/noBarrelFile: Entry point for package exports
export {
  Message,
  Omit,
  Reasoning,
  Region,
  ToolCall,
  ToolResult,
  Truncate,
} from "./components";
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
