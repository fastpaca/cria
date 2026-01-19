# Write custom components

Custom components are just functions that return prompt builders (or prompt nodes). Treat them like UI components: small, composable blocks with clear responsibilities.

## Builder-style component (recommended)

```ts
import { cria } from "@fastpaca/cria";

export const systemRules = () =>
  cria.prompt().system("You are a helpful assistant. Be concise.");

export const contextBlock = (title: string, context: string) =>
  cria
    .prompt()
    .scope((p) => p.message("assistant", `${title}\n${context}`));
```

## Element-level component (escape hatch)

```ts
import { type PromptNode } from "@fastpaca/cria";

export const systemMessage = (text: string): PromptNode => ({
  kind: "message",
  role: "system",
  children: [{ type: "text", text }],
});
```

## Notes for chat providers

- Chat providers only output `Message` nodes. If you want content to appear in OpenAI/Anthropic chat payloads, keep it inside a message.
- Avoid nesting `Message` inside `Message` (keep messages as leaf nodes).
