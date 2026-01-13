# Mental model

Cria treats prompts like a structured tree (similar to a UI component tree). That lets you build prompts as structured code: compose reusable pieces, keep roles explicit, and render the same tree to different targets (markdown, OpenAI, Anthropic, AI SDK) without rewriting your prompt.

## What Cria is

- A fluent DSL for assembling prompt structure (`cria.prompt()`).
- A small IR (intermediate representation): regions + semantic nodes (messages, tool messages, reasoning).
- A rendering layer: turn the same prompt tree into different provider payloads.
- Optional compaction: when you set a token `budget`, strategies decide what can shrink first.

## What Cria is not

- Not an LLM SDK: you still call OpenAI/Anthropic/AI SDK yourself.
- Not a tool runner: Cria can represent tool calls/results in the prompt, but it doesn’t execute tools.

## DSL vs optional JSX

- **DSL (default):** chain calls on `cria.prompt()`.
- **JSX (optional):** use `@fastpaca/cria/jsx` if your team prefers TSX; it produces the same underlying tree.

## Rendering vs calling a model

Rendering converts your prompt tree into a provider-specific payload (or markdown). Calling a model is still done via the provider’s SDK.

- Start here: [Quickstart](quickstart.md)
- Then: [Use with OpenAI](how-to/use-with-openai.md), [Anthropic](how-to/use-with-anthropic.md), or [Vercel AI SDK](how-to/use-with-vercel-ai-sdk.md)

## Budgets & compaction (optional)

If you pass a `budget` to `render()`, Cria will fit the prompt to that token limit by applying strategies to the *least important* content first.

- Lower `priority` number = more important (kept longer)
- Higher `priority` number = less important (shrunk/omitted sooner)

Next: [Fit & compaction](how-to/fit-and-compaction.md)

## Tool messages and reasoning traces

Cria models these as semantic nodes so renderers can emit provider-native formats:

- `ToolCall` / `ToolResult`: tool I/O *messages* in the prompt
- `Reasoning`: optional reasoning text for providers that support it

Treat these like any other content for compaction: give them priorities, truncate/summarize them, or omit them when you’re over budget.
