# Integrations

Cria ships plug-and-play renderers and provider components for common LLM SDKs.

## OpenAI

### Chat Completions

```tsx
import OpenAI from "openai";
import { chatCompletions } from "@fastpaca/cria/openai";
import { render } from "@fastpaca/cria";

const client = new OpenAI();
const messages = await render(prompt, { tokenizer, budget, renderer: chatCompletions });
const response = await client.chat.completions.create({ model: "gpt-4o", messages });
```

### Responses (reasoning models)

```tsx
import { responses } from "@fastpaca/cria/openai";
import { render } from "@fastpaca/cria";

// Reuse your OpenAI client
const input = await render(prompt, { tokenizer, budget, renderer: responses });
const response = await client.responses.create({ model: "o3", input });
```

### Provider

`OpenAIProvider` injects a model provider so components like `Summary` can
summarize without a custom function.

## Anthropic

```tsx
import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@fastpaca/cria/anthropic";
import { render } from "@fastpaca/cria";

const client = new Anthropic();
const { system, messages } = await render(prompt, {
  tokenizer,
  budget,
  renderer: anthropic,
});
const response = await client.messages.create({ model: "claude-sonnet-4-20250514", system, messages });
```

`AnthropicProvider` works like `OpenAIProvider` for components that need a model.

## Vercel AI SDK

```tsx
import { renderer } from "@fastpaca/cria/ai-sdk";
import { render } from "@fastpaca/cria";
import { generateText } from "ai";

const messages = await render(prompt, { tokenizer, budget, renderer });
const { text } = await generateText({ model, messages });
```

`AISDKProvider` provides a model for `Summary` or other AI-backed components.

`Messages` converts AI SDK UI messages into Cria elements, and
`DEFAULT_PRIORITIES` gives a sensible starting point.

## Related

- [OpenAI Chat Completions](../examples/openai-chat-completions)
- [OpenAI Responses](../examples/openai-responses)
- [Anthropic](../examples/anthropic)
- [Vercel AI SDK](../examples/ai-sdk)
