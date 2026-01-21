# Components (reference)

This is a lightweight map of what exists and when you’d reach for it. For the full contract (all options and exact shapes), prefer reading the TypeScript types in `src/`—the docs intentionally don’t mirror every API detail.

## Structure

- `Scope`: groups children into a logical block (a “subtree” you can prioritize and compact).
- `Message`: semantic messages with roles (`system`, `developer`, `user`, `assistant`, `tool`). Tool messages must contain only `ToolResult`.

## Fit & compaction

- `Truncate`: shrink content to a token budget when fitting.
- `Omit`: drop content entirely when fitting.
- `Last`: keep only the last N items (useful for chat history).
- `Summary`: replace older content with a cached summary when fitting (requires a store; uses a provider or custom summarizer).

## Retrieval

- `VectorSearch`: inject retrieval results at render time from a `VectorMemory` store.

## Semantic nodes (provider mapping)

These exist so providers can emit provider-native formats and so you can compact “traces” intentionally.

- `ToolCall`: tool calls made by the assistant (must live inside an assistant message).
- `ToolResult`: tool output returned to the model (must live inside a tool message).
- `Reasoning`: optional reasoning text (assistant-only).

## Formatting helpers

- `Examples`: wraps example content with separators and an optional title.
- `CodeBlock`: wraps code in a fenced code block.
- `Separator`: inserts a separator between children.

## Where to look next

- [Quickstart](quickstart.md)
- [Fit & compaction](how-to/fit-and-compaction.md)
