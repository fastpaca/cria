# Write custom components

Custom components are just functions that return prompt builders (or prompt elements). Treat them like UI components: small, composable blocks with clear responsibilities.

## Builder-style component (recommended)

```ts
import { cria } from "@fastpaca/cria";

export const systemRules = () =>
  cria.prompt().system("You are a helpful assistant. Be concise.");

export const contextBlock = (title: string, context: string) =>
  cria
    .prompt()
    .region((r) => r.message("assistant", `${title}\n${context}`, { priority: 2 }));
```

## Element-level component (escape hatch)

```ts
import { type PromptElement } from "@fastpaca/cria";

export const systemMessage = (text: string): PromptElement => ({
  kind: "message",
  role: "system",
  priority: 0,
  children: [text],
});
```

## Notes for chat providers

- Chat providers only output `Message` nodes. If you want content to appear in OpenAI/Anthropic chat payloads, keep it inside a message.
- Avoid nesting `Message` inside `Message` (keep messages as leaf nodes).
