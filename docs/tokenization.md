# Tokenization

Budget fitting needs token counts. Cria can get them from a tokenizer you pass directly, or from a provider's built-in default. No tokenizer and no provider? Cria throws so you don't silently miscount.

## Three ways to supply a tokenizer

| Method | When to use |
| --- | --- |
| `render(prompt, { tokenizer })` | You want exact counts for your model |
| Provider component | Good defaults, no extra setup |
| Custom `ModelProvider` | Building your own integration |

Providers (`OpenAIProvider`, `AnthropicProvider`, `AISDKProvider`) ship with a tiktoken-based tokenizer. Pass `tokenizer` to the provider to override it.

## Bring your own tokenizer

A tokenizer is just a function: `(text: string) => number`. Wrap any library:

```ts
import { encoding_for_model } from "tiktoken";
import { render } from "@fastpaca/cria";

const enc = encoding_for_model("gpt-4o");
const tokenizer = (text: string) => enc.encode(text).length;

const output = await render(prompt, { tokenizer, budget: 12_000 });
```

Use tiktoken for OpenAI models, `@anthropic-ai/tokenizer` for Claude. Match tokenizer to model.

## How provider defaults work

Built-in providers use tiktoken (cl100k-based). This is accurate for OpenAI and a reasonable approximation for others. If tiktoken fails to load, Cria falls back to `Math.ceil(text.length / 4)`—a rough heuristic, not production-grade.

## Error handling

Set a budget without a tokenizer source and Cria throws immediately. This is intentional: silent miscounts break budget fitting in ways that are hard to debug later.
