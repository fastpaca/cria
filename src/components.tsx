import type {
  PromptChildren,
  PromptElement,
  PromptFragment,
  Strategy,
  StrategyInput,
} from "./types";

/** Props for the Region component. */
interface RegionProps {
  /** Lower number = higher importance. Default: 0 (highest priority) */
  priority?: number;
  /** Optional strategy to apply when this region needs to shrink */
  strategy?: Strategy;
  /** Stable identifier for caching/debugging */
  id?: string;
  /** Content of this region */
  children?: PromptChildren;
}

/**
 * The fundamental building block of Cria prompts—think of it as `<div>`.
 *
 * Regions define sections of your prompt with a priority level. During fitting,
 * regions with higher priority numbers (less important) are reduced first.
 *
 * @example
 * ```tsx
 * <Region priority={0}>You are a helpful assistant.</Region>
 * <Region priority={2}>{documents}</Region>
 * <Region priority={1}>{userMessage}</Region>
 * ```
 */
export function Region({
  priority = 0,
  strategy,
  id,
  children = [],
}: RegionProps): PromptElement {
  return {
    priority,
    children: children as (PromptElement | string)[],
    ...(strategy && { strategy }),
    ...(id && { id }),
  };
}

/** Props for the Truncate component. */
interface TruncateProps {
  /** Maximum token count for this region's content */
  budget: number;
  /** Which end to truncate from. Default: "start" */
  from?: "start" | "end";
  /** Lower number = higher importance. Default: 0 */
  priority?: number;
  /** Stable identifier for caching/debugging */
  id?: string;
  /** Content to truncate */
  children?: PromptChildren;
}

/**
 * A region that truncates its content to fit within a token budget.
 *
 * When the overall prompt exceeds budget, Truncate regions progressively
 * remove content from the specified direction until they meet their budget.
 *
 * @example
 * ```tsx
 * <Truncate budget={20000} priority={2}>
 *   {conversationHistory}
 * </Truncate>
 * ```
 */
export function Truncate({
  budget,
  from = "start",
  priority = 0,
  id,
  children = [],
}: TruncateProps): PromptElement {
  const strategy: Strategy = (input: StrategyInput): PromptFragment[] => {
    const { target, tokenizer } = input;
    if (target.tokens <= budget) {
      return [target];
    }

    let content = target.content;
    let tokens = target.tokens;

    // TODO(v1): Optimize - this calls tokenizer O(n) times. Consider:
    // - Estimate chars/token ratio, binary search to target
    // - Cache intermediate token counts
    while (tokens > budget && content.length > 0) {
      const charsToRemove = Math.max(1, Math.floor(content.length * 0.1));
      if (from === "start") {
        content = content.slice(charsToRemove);
      } else {
        content = content.slice(0, -charsToRemove);
      }
      tokens = tokenizer(content);
    }

    if (content.length === 0) {
      return [];
    }

    return [
      {
        content,
        tokens,
        priority: target.priority,
        regionId: target.regionId,
        index: target.index,
      },
    ];
  };

  return {
    priority,
    children: children as (PromptElement | string)[],
    strategy,
    ...(id && { id }),
  };
}

/** Props for the Omit component. */
interface OmitProps {
  /** Lower number = higher importance. Default: 0 */
  priority?: number;
  /** Stable identifier for caching/debugging */
  id?: string;
  /** Content that may be omitted */
  children?: PromptChildren;
}

/**
 * A region that is entirely removed when the prompt needs to shrink.
 *
 * Use Omit for "nice to have" content that can be dropped entirely if needed.
 * When the prompt exceeds budget, Omit regions are removed (lowest priority first).
 *
 * @example
 * ```tsx
 * <Omit priority={3}>
 *   {optionalExamples}
 * </Omit>
 * ```
 */
export function Omit({
  priority = 0,
  id,
  children = [],
}: OmitProps): PromptElement {
  const strategy: Strategy = (): PromptFragment[] => [];

  return {
    priority,
    children: children as (PromptElement | string)[],
    strategy,
    ...(id && { id }),
  };
}
