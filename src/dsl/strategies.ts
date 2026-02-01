/**
 * Strategy factories and component helpers for the DSL module.
 */

import type {
  CacheHint,
  MessageChildren,
  PromptMessageNode,
  PromptPart,
  PromptRole,
  PromptScope,
  ProviderToolIO,
  ScopeChildren,
  Strategy,
} from "../types";

/**
 * Create a scope node with optional priority, strategy, and id.
 */
export function createScope<TToolIO extends ProviderToolIO>(
  children: ScopeChildren<TToolIO>,
  opts?: {
    priority?: number;
    strategy?: Strategy;
    id?: string;
    cache?: CacheHint;
  }
): PromptScope<TToolIO> {
  // Thin helper that preserves tool IO types without coercion.
  return {
    kind: "scope",
    priority: opts?.priority ?? 0,
    children,
    ...(opts?.strategy && { strategy: opts.strategy }),
    ...(opts?.id && { id: opts.id }),
    ...(opts?.cache && { cache: opts.cache }),
  };
}

/**
 * Create a message node with role and children.
 */
export function createMessage<TToolIO extends ProviderToolIO>(
  role: PromptRole,
  children: MessageChildren<TToolIO>,
  id?: string
): PromptMessageNode<TToolIO> {
  // Message nodes only carry already-normalized parts; no conversion happens here.
  return {
    kind: "message",
    role,
    children,
    ...(id && { id }),
  };
}

/**
 * Create a truncate strategy that removes children from one end.
 */
export function createTruncateStrategy(
  budget: number,
  from: "start" | "end"
): Strategy {
  return (input) => {
    const { children } = input.target;
    if (children.length === 0) {
      return null;
    }

    const dropCount = Math.max(1, Math.floor(input.totalTokens / budget));
    const nextChildren =
      from === "start"
        ? children.slice(dropCount)
        : children.slice(0, Math.max(0, children.length - dropCount));

    if (nextChildren.length === 0) {
      return null;
    }

    return { ...input.target, children: nextChildren };
  };
}

/**
 * Create an omit strategy that removes the entire scope.
 */
export function createOmitStrategy(): Strategy {
  return () => null;
}

/**
 * Format examples into a text prompt part.
 */
export function formatExamples<TToolIO extends ProviderToolIO>(
  title: string,
  items: readonly string[],
  separator = "\n\n"
): PromptPart<TToolIO> {
  const body = items.length === 0 ? "" : items.join(separator);
  const text = title ? `${title}\n${body}` : body;
  return { type: "text", text };
}
