# Tokenization and budgets

Cria fits prompts to a token budget. Token counts come from a tokenizer, and you can supply one explicitly or let a provider do it for you. If you set a budget without a tokenizer or provider, Cria throws to prevent silent miscounts.

## Where token counts come from

- `render(prompt, { tokenizer, budget })`: pass a tokenizer directly (recommended for accuracy, e.g. tiktoken, `@anthropic-ai/tokenizer`).
- Provider components: `<OpenAIProvider>`, `<AnthropicProvider>`, and `<AISDKProvider>` include an approximate tokenizer by default. Pass `tokenizer` to those components to use a model-specific function.
- Custom providers: add a `tokenizer` property to your `ModelProvider` so Cria can use it during fitting.

## Accuracy vs. convenience

- **Accurate**: use model-specific tokenizers (tiktoken for OpenAI/AI SDK, `@anthropic-ai/tokenizer` for Anthropic). Example:

  ```ts
  import { encoding_for_model } from "tiktoken";
  import { render } from "@fastpaca/cria";

  const enc = encoding_for_model("gpt-4o");
  const tokenizer = (text: string) => enc.encode(text).length;

  const output = await render(prompt, { tokenizer, budget: 12_000 });
  ```

- **Approximate**: provider defaults use a simple `Math.ceil(text.length / 4)` heuristic. Good for quick starts; switch to an accurate tokenizer before relying on tight budgets.

## What happens if you forget

- Budgets without any tokenizer source (neither render option nor provider) throw an error so you know to configure one.
- Budgets with a provider but no explicit tokenizer use the provider's tokenizer (approximate by default for built-ins).

## Tips

- Keep the tokenizer aligned with the model you call; mismatches can over- or under-count.
- If you build custom components that rely on token counts, thread the tokenizer through rather than re-counting content yourself.
