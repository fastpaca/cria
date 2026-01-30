/**
 * Prompt pipeline mental model (authoritative + opinionated):
 *
 * Fluent DSL
 *    |
 *    v
 * PromptTree  (scopes + message leaves)
 *    |
 *    v
 * PromptLayout (flat, role-shaped messages)
 *    |
 *    v
 * RenderOut (provider payloads)
 *
 * Why this shape?
 * - Scopes exist for compaction/strategy. They are structural only.
 * - Messages are semantic boundaries. They are leaf nodes and only hold parts.
 * - Parts are the smallest typed units (text/reasoning/tool-call/tool-result).
 *
 * PromptLayout intentionally normalizes message shapes so codecs do NOT
 * re-interpret parts or re-check invariants. Some providers (AI SDK, Anthropic)
 * require a parts array, so codecs re-expand assistant/tool data back into
 * parts. That is a translation step for provider compatibility, not a loop in
 * the core model.
 */

import type { ModelProvider } from "./provider";

/**
 * Message role used by semantic `kind: "message"` nodes.
 *
 * This is intentionally compatible with common LLM SDKs
 * (system/developer/user/assistant/tool).
 */
export type PromptRole = "system" | "developer" | "user" | "assistant" | "tool";

/**
 * Provider-specific tool IO contract.
 *
 * Each provider pins the concrete types used for tool-call inputs and
 * tool-result outputs. Those types flow through the prompt tree and layout so
 * codecs can translate without defensive serialization later.
 */
export interface ProviderToolIO {
  callInput: unknown;
  resultOutput: unknown;
}

/**
 * Tool IO for an unbound prompt.
 *
 * If a prompt has no provider, tool IO is "never" so tool parts cannot be
 * constructed until a provider supplies the IO contract. This avoids runtime
 * checks by pushing the constraint into the type system.
 */
interface UnboundToolIO {
  callInput: never;
  resultOutput: never;
}

/**
 * Resolve the tool IO contract for a given provider type.
 *
 * This is the bridge between a provider binding and the rest of the DSL:
 * it extracts the provider's tool IO types so parts/messages/layouts carry
 * the correct shapes end-to-end.
 */
export type ToolIOForProvider<P> =
  P extends ModelProvider<unknown, infer TToolIO> ? TToolIO : UnboundToolIO;

// Typed accessors for tool IO fields; keeps index access localized and clear.
type ToolCallInput<TToolIO extends ProviderToolIO> = TToolIO["callInput"];
type ToolResultOutput<TToolIO extends ProviderToolIO> = TToolIO["resultOutput"];

/**
 * Context that can be provided through the component tree.
 *
 * Provider scopes inject context so children inherit the same provider binding
 * and tool IO contract during rendering and strategy execution.
 */
export interface CriaContext {
  /** Model provider for AI-powered operations */
  provider?: ModelProvider<unknown, ProviderToolIO> | undefined;
}

// Convenience type for APIs that can be sync or async.
export type MaybePromise<T> = T | Promise<T>;

/**
 * Provider cache hint for prompt prefix pinning.
 *
 * Cache pinning is a hint that a region is stable across runs and should be
 * considered for provider-side prompt/KV caching when it appears in the
 * contiguous prompt prefix.
 */
export interface CacheHint {
  mode: "pin";
  /** Stable identifier for the pinned region. */
  id: string;
  /** Human-managed version for the pinned prefix. */
  version: string;
  /** Optional grouping key (for example, tenant + policy version). */
  scopeKey?: string | undefined;
  /** Optional TTL hint in seconds. Providers may ignore this. */
  ttlSeconds?: number | undefined;
}

/**
 * Content parts that appear as leaf nodes in message nodes.
 *
 * Tool parts directly embed provider-native input/output shapes, so a bound
 * provider determines their types without runtime validation.
 */
export interface ToolCallPart<TToolIO extends ProviderToolIO = ProviderToolIO> {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: ToolCallInput<TToolIO>;
}

export interface ToolResultPart<
  TToolIO extends ProviderToolIO = ProviderToolIO,
> {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: ToolResultOutput<TToolIO>;
}

/**
 * The smallest typed units used inside messages.
 *
 * Keeping tool IO typed at the part level forces every higher-level structure
 * (messages/layout/tree) to stay provider-consistent.
 */
export type PromptPart<TToolIO extends ProviderToolIO = ProviderToolIO> =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | ToolCallPart<TToolIO>
  | ToolResultPart<TToolIO>;

/** Convenience type for reasoning parts in a typed prompt. */
export type ReasoningPart<TToolIO extends ProviderToolIO = ProviderToolIO> =
  Extract<PromptPart<TToolIO>, { type: "reasoning" }>;
/** Convenience type for text parts in a typed prompt. */
export type TextPart<TToolIO extends ProviderToolIO = ProviderToolIO> = Extract<
  PromptPart<TToolIO>,
  { type: "text" }
>;

/**
 * Structural scope node in the prompt tree.
 *
 * Scopes group messages for composition and compaction while keeping the tool
 * IO types consistent across all descendants.
 */
export interface PromptScope<TToolIO extends ProviderToolIO = ProviderToolIO> {
  kind: "scope";
  priority: number;
  strategy?: Strategy | undefined;
  id?: string | undefined;
  context?: CriaContext | undefined;
  cache?: CacheHint | undefined;
  children: readonly PromptNode<TToolIO>[];
}

/**
 * Message boundary node in the prompt tree.
 *
 * A message node is role-shaped and contains parts that already carry the
 * provider-bound tool IO types.
 */
export interface PromptMessageNode<
  TToolIO extends ProviderToolIO = ProviderToolIO,
> {
  kind: "message";
  role: PromptRole;
  id?: string | undefined;
  children: readonly PromptPart<TToolIO>[];
}

/**
 * Nodes in the prompt tree.
 *
 * Scopes provide structure and strategy boundaries. Message nodes are the
 * semantic leaves that carry typed parts. The generic parameter ensures tool
 * IO types stay consistent across the entire tree.
 */
export type PromptNode<TToolIO extends ProviderToolIO = ProviderToolIO> =
  | PromptScope<TToolIO>
  | PromptMessageNode<TToolIO>;

/**
 * Root prompt tree type.
 *
 * The root is always a scope so strategies can operate at the top level while
 * preserving the provider-bound tool IO types for all descendants.
 */
export type PromptTree<TToolIO extends ProviderToolIO = ProviderToolIO> =
  PromptScope<TToolIO>;

/** Shorthand for scope children with a shared tool IO contract. */
export type ScopeChildren<TToolIO extends ProviderToolIO = ProviderToolIO> =
  readonly PromptNode<TToolIO>[];
/** Shorthand for message children with a shared tool IO contract. */
export type MessageChildren<TToolIO extends ProviderToolIO = ProviderToolIO> =
  readonly PromptPart<TToolIO>[];

/** System messages are plain text and carry no tool information. */
export interface SystemMessage {
  role: "system";
  text: string;
}

/** Developer messages are plain text and carry no tool information. */
export interface DeveloperMessage {
  role: "developer";
  text: string;
}

/** User messages are plain text and carry no tool information. */
export interface UserMessage {
  role: "user";
  text: string;
}

/**
 * Assistant messages can include reasoning and tool calls in addition to text.
 * Tool call inputs are typed by the provider binding.
 */
export interface AssistantMessage<
  TToolIO extends ProviderToolIO = ProviderToolIO,
> {
  role: "assistant";
  text: string;
  reasoning?: string | undefined;
  toolCalls?: readonly ToolCallPart<TToolIO>[] | undefined;
}

/**
 * Tool messages represent a single tool result with provider-typed output.
 */
export interface ToolMessage<TToolIO extends ProviderToolIO = ProviderToolIO> {
  role: "tool";
  toolCallId: string;
  toolName: string;
  output: ToolResultOutput<TToolIO>;
}

/**
 * PromptLayout is a list of fully-shaped messages. The union is deliberate:
 * - Assistant messages can include reasoning/toolCalls.
 * - Tool messages are singular tool results with call metadata.
 * - System/User messages are text-only.
 * This keeps invalid combinations out of the layout by construction.
 *
 * The layout is the normalized form that codecs consume. It is produced by
 * flattening the prompt tree and should not require further validation.
 */
export type PromptMessage<TToolIO extends ProviderToolIO = ProviderToolIO> =
  | SystemMessage
  | DeveloperMessage
  | UserMessage
  | AssistantMessage<TToolIO>
  | ToolMessage<TToolIO>;

/** Flat, role-shaped message list used by codecs and token counting. */
export type PromptLayout<TToolIO extends ProviderToolIO = ProviderToolIO> =
  readonly PromptMessage<TToolIO>[];

/**
 * Provider-agnostic descriptor of the pinned prompt prefix.
 *
 * This is computed after fitting so providers can translate the descriptor into
 * their native caching features (for example, cache control blocks or prompt
 * cache keys).
 */
export interface CacheDescriptor {
  /** Pinned scope ids that contribute to the contiguous pinned prefix. */
  pinIdsInPrefix: readonly string[];
  /** Pin version for the contiguous pinned prefix, if any. */
  pinVersionInPrefix?: string | undefined;
  /** Message indexes that belong to the pinned prefix. */
  pinnedMessageIndexes: readonly number[];
  /** Number of pinned messages in the contiguous prefix. */
  pinnedPrefixMessageCount: number;
  /**
   * Optional shared scope key when all prefix pins agree on the same value.
   * When pins disagree, this will be undefined.
   */
  scopeKey?: string | undefined;
  /**
   * Optional shared TTL hint (seconds) when all prefix pins agree on the same
   * value. Providers may ignore this.
   */
  ttlSeconds?: number | undefined;
}

/**
 * Result of applying a strategy to a scope.
 *
 * Returning null means "drop this scope entirely".
 */
export type StrategyResult<TToolIO extends ProviderToolIO = ProviderToolIO> =
  PromptScope<TToolIO> | null;

/**
 * Context passed to strategy functions during the fit loop.
 *
 * @property target - The specific scope to reduce
 * @property totalTokens - Current total token count for the prompt
 * @property iteration - Which iteration of the fit loop (for debugging)
 * @property context - Inherited context from ancestor provider components
 */
export interface StrategyInput<
  TToolIO extends ProviderToolIO = ProviderToolIO,
> {
  target: PromptScope<TToolIO>;
  totalTokens: number;
  iteration: number;
  /** Context inherited from ancestor provider components */
  context: CriaContext;
}

/**
 * A Strategy function that rewrites a scope subtree when the prompt is over budget.
 *
 * Strategies are applied during fitting, starting from the least important
 * priority (highest number). Strategies run **bottom-up** (post-order) so nested
 * scopes get a chance to shrink before their parents.
 *
 * Strategies must be:
 * - **Pure**: don't mutate the input element
 * - **Deterministic**
 * - **Idempotent**
 *
 * Strategies have full ownership of their subtree: they can replace the element
 * and/or rewrite any children.
 *
 * The generic parameter ensures strategies preserve the tool IO contract
 * instead of re-shaping it.
 */
export type Strategy = <TToolIO extends ProviderToolIO>(
  input: StrategyInput<TToolIO>
) => MaybePromise<StrategyResult<TToolIO>>;

/**
 * Error thrown when the prompt cannot be fit within the budget.
 *
 * This is a standard error that should be caught and handled by the caller.
 *
 * This happens when:
 * - No strategies remain but still over budget
 * - Strategies made no progress (possible infinite loop)
 *
 * @property overBudgetBy - How many tokens over budget
 * @property priority - The priority level where fitting failed (-1 if no strategies)
 * @property iteration - Which iteration of the fit loop failed
 */
export class FitError extends Error {
  overBudgetBy: number;
  priority: number;
  iteration: number;
  budget: number;
  totalTokens: number;

  constructor(params: {
    overBudgetBy: number;
    priority: number;
    iteration: number;
    budget: number;
    totalTokens: number;
  }) {
    const { overBudgetBy, priority, iteration, budget, totalTokens } = params;
    super(
      `Cannot fit prompt: ${totalTokens} tokens exceeds budget ${budget} by ${overBudgetBy} at priority ${priority} (iteration ${iteration})`
    );
    this.name = "FitError";
    this.overBudgetBy = overBudgetBy;
    this.priority = priority;
    this.iteration = iteration;
    this.budget = budget;
    this.totalTokens = totalTokens;
  }
}
