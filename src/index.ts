/**
 * Cria - JSX-based prompt renderer with automatic token budget fitting.
 *
 * @example
 * ```tsx
 * import { render, Region, Truncate, Omit } from "cria";
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
export { Omit, Region, Truncate } from "./components";
export { render } from "./render";
export type {
  PromptChildren,
  PromptElement,
  PromptFragment,
  Strategy,
  StrategyInput,
  Tokenizer,
} from "./types";
export { FitError } from "./types";
