# Cria Docs

Welcome to the Cria docs. This set is short by design and focuses on the core concepts and the parts you'll use most often.

## What is Cria?

Cria is a fluent DSL for structured prompt engineering. Build prompts as regions with priorities and strategies, then render to OpenAI, Anthropic, or Vercel AI SDK formats with no changes.

Prefer TSX? Import the optional JSX surface from `@fastpaca/cria/jsx`. The default API is DSL-first.

Because prompts are structured as a tree, you get budget fitting for free: assign priorities to regions and Cria trims low-priority content when you hit your token limit.

- [Quickstart](quickstart.md)
- [Concepts](concepts.md)
- [Components](components.md)
- [Custom components](custom-components.md)
- [Integrations](integrations.md)
- [Memory and RAG](memory-and-rag.md)
- [Strategies](strategies.md)
- [Tokenization](tokenization.md)
- [Errors](errors.md)
- [Observability](observability.md)
- [Recipes](recipes.md)

## Using budgets?

Budget fitting needs token counts. Providers include tiktoken defaults; you can bring your own tokenizer for exact accuracy. See [Tokenization](tokenization.md).

## Runnable examples

- [OpenAI Chat Completions](../examples/openai-chat-completions)
- [OpenAI Responses](../examples/openai-responses)
- [Anthropic](../examples/anthropic)
- [Vercel AI SDK](../examples/ai-sdk)
- [Summaries](../examples/summary)
- [RAG](../examples/rag)
