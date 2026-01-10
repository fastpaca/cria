# Tokenization and budgets

Cria fits prompts to a token budget. Token counts come from a tokenizer, and you can supply one explicitly or let a provider do it for you. If you set a budget without a tokenizer or provider, Cria throws to prevent silent miscounts.

## Where token counts come from

- `render(prompt, { tokenizer, budget })`: pass a tokenizer directly (recommended for accuracy, e.g. tiktoken, `@anthropic-ai/tokenizer`).
- Provider components: `<OpenAIProvider>`, `<AnthropicProvider>`, and `<AISDKProvider>` default to a tiktoken-based tokenizer. Pass `tokenizer` to those components to override (for custom models or alternative tokenizers).
- Custom providers: add a `tokenizer` property to your `ModelProvider` so Cria can use it during fitting.

## Accuracy vs. convenience

- **Built-in default (accurate)**: providers use tiktoken under the hood (cl100k-based, model-aware when a model is provided). This is accurate for OpenAI/AI SDK models and a good approximation for others.
- **Custom accurate**: use model-specific tokenizers directly (tiktoken for OpenAI/AI SDK, `@anthropic-ai/tokenizer` for Anthropic). Example:

  ```ts
  import { encoding_for_model } from "tiktoken";
  import { render } from "@fastpaca/cria";

  const enc = encoding_for_model("gpt-4o");
  const tokenizer = (text: string) => enc.encode(text).length;

  const output = await render(prompt, { tokenizer, budget: 12_000 });
  ```

- **Approximate fallback**: when tiktoken can't load, Cria falls back to a simple `Math.ceil(text.length / 4)` heuristic. Use this only as a last resort.

## What happens if you forget

- Budgets without any tokenizer source (neither render option nor provider) throw an error so you know to configure one.
- Budgets with a provider but no explicit tokenizer use the provider's tokenizer (tiktoken-based by default for built-ins).

## Tips

- Keep the tokenizer aligned with the model you call; mismatches can over- or under-count.
- If you build custom components that rely on token counts, thread the tokenizer through rather than re-counting content yourself.
