# Prompt Pipeline Spec (DSL -> PromptTree -> PromptLayout -> RenderOut)

## Status

- Draft
- Owner: Cria core
- Scope: IR, DSL, rendering, and compaction boundaries

## Purpose

Cria needs a crisp, opinionated mental model with a small, authoritative core:

Fluent DSL -> PromptTree -> PromptLayout -> RenderOut

This spec defines the target model, calls out current problems, and outlines a migration path that leans on TypeScript at the boundaries so we can delete defensive patterns inside the core.

## Goals

- Make PromptTree the authoritative IR for composition and fitting.
- Flatten to a list of opinionated messages (PromptLayout) in a deterministic, provider-agnostic way.
- Renderers receive already-shaped messages and do not re-validate invariants.
- Use TypeScript to prevent invalid trees/layouts by construction.
- Keep component authoring simple and predictable.

## Non-goals

- Redesign provider integrations or model APIs.
- Reintroduce JSX-style "accept anything" children.
- Change compaction strategy behavior beyond typing and invariants.
- Preserve backward compatibility. This is a breaking change.

## Current problems

- The tree allows strings/parts/nodes everywhere, so invalid shapes are easy to construct and only fail at runtime.
- Message constraints are runtime-only (tool results, tool calls, reasoning) and not enforced by types.
- Layout is "messages + parts" which forces renderers to interpret parts and re-apply rules.
- The DSL accepts too many child shapes outside messages, so coercion bleeds into structural nodes.

## Target model

### Flow

1) DSL builds PromptTree (scopes + messages).
2) PromptTree is flattened into PromptLayout (a list of fully shaped messages).
3) Renderers map PromptLayout to provider payloads (RenderOut).

### PromptTree

PromptTree is a tree of two node kinds:

- Scope: structural grouping + priority/strategy/context.
- Message: semantic boundary + role + message parts.

Decision: messages are leaf nodes under scopes. The PromptTree root is a scope; top-level messages are direct children of that root scope. Scopes exist to group messages for compaction and composition.

Type sketch (illustrative, not final):

```ts
export type TextPart = { type: "text"; text: string };
export type ReasoningPart = { type: "reasoning"; text: string };
export type ToolCallPart = { type: "tool-call"; toolCallId: string; toolName: string; input: unknown };
export type ToolResultPart = { type: "tool-result"; toolCallId: string; toolName: string; output: unknown };
export type MessagePart = TextPart | ReasoningPart | ToolCallPart | ToolResultPart;

export type PromptNode = ScopeNode | MessageNode;

export interface ScopeNode {
  kind: "scope";
  priority: number;
  strategy?: Strategy;
  id?: string;
  context?: CriaContext;
  children: readonly PromptNode[];
}

export interface MessageNode {
  kind: "message";
  role: PromptRole;
  id?: string;
  children: readonly MessagePart[];
}

export type PromptTree = ScopeNode;
```

Notes:

- No raw strings in PromptTree. Text is always a `TextPart`.
- Message nodes contain only parts, not other nodes.
- Scopes can contain message nodes and other scopes.
- Compaction runs only on scopes. To compact a message, wrap it in a scope.

### PromptLayout

PromptLayout is a flat, opinionated list of messages. It encodes role-specific shapes so renderers do not reinterpret parts.

Type sketch (illustrative):

```ts
type SystemMessage = { role: "system"; text: string };
type UserMessage = { role: "user"; text: string };
type AssistantMessage = {
  role: "assistant";
  text: string;
  reasoning?: string;
  toolCalls?: readonly ToolCallPart[];
};
type ToolMessage = {
  role: "tool";
  toolCallId: string;
  toolName: string;
  output: unknown;
};
type CustomMessage = { role: string; text: string };

export type PromptMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage
  | CustomMessage;

export type PromptLayout = readonly PromptMessage[];
```

Flattening rules:

- Messages are emitted in depth-first, left-to-right order.
- Text parts are concatenated into `text`.
- Assistant reasoning parts are concatenated into `reasoning`.
- Assistant tool-call parts are collected into `toolCalls`.
- Tool messages must contain exactly one tool-result part.
- Non-assistant, non-tool roles accept only text parts.

### RenderOut

RenderOut is provider-specific. Renderers map each `PromptMessage` to the provider payload shape and assume invariants already hold.

## Boundary guidelines

- The DSL is the primary boundary for type safety; it must not allow invalid tree shapes.
- A single runtime `assertPromptTree` can exist for non-typed entry points (tests, JS usage), but normal flows should not rely on it.
- Strategies must return a valid `PromptNode` or `null`, and must be pure/idempotent.
- Compaction is scope-only; message nodes never carry strategy/priority.

## DSL and component guidelines

- `scope()` is the structural primitive (rename from `region`).
- `message()` builders create `MessageNode` and accept only message parts.
- The DSL accepts `string | number | boolean` for message content and coerces to `TextPart` internally.
- `c` template literal returns `readonly MessagePart[]` and only interpolates values that can be coerced to message parts.
- Components are scope factories: they can render children into one or more messages.

## Implementation plan

### Phase 0: Introduce new IR types

- Add `ScopeNode`, `MessageNode`, `MessagePart`, and `PromptLayout` message union types.
- Update `layoutPrompt` to flatten PromptTree -> PromptLayout (message list).

### Phase 1: Update DSL to build PromptTree

- Keep the current fluent DSL shape; coerce string-like values to `TextPart`.
- Remove strings as valid children outside message parts.
- Use `Scope` (formerly `Region`) and `scope()` in the DSL.

### Phase 2: Update components

- Components return scopes or message nodes only.
- Summary and VectorDB search emit message parts, not raw strings.

### Phase 3: Update rendering and fit

- `render()` uses `layoutPrompt` and the new `PromptLayout` message union.
- Renderers map `PromptMessage` directly without internal validation.
- Fit loop operates on scopes/messages only.

### Phase 4: Remove old IR (breaking)

- Delete `PromptChild` with raw strings and any adapter layers.
- Remove the old `PromptLayout` with `parts` arrays entirely.
- Remove `assertValidMessageScope` from the core render path.

## Acceptance criteria

- TypeScript prevents text nodes outside message parts at compile time.
- PromptLayout is a list of fully shaped messages, not parts.
- Renderers no longer need defensive checks for message invariants.
- DSL and core components compile with no `as` casts for children.

## Open questions

- Should custom roles be strictly text-only, or allow assistant-style fields?
