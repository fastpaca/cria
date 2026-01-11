# Integrations

Cria ships plug-and-play renderers and provider helpers for common LLM SDKs. Write your prompt once with the DSL, render it to any format. JSX remains optional via `@fastpaca/cria/jsx` if you prefer TSX.

## OpenAI

### Chat Completions

```ts
import OpenAI from "openai";
import { chatCompletions } from "@fastpaca/cria/openai";
import { cria } from "@fastpaca/cria";

const client = new OpenAI();
const messages = await cria
  .prompt()
  .system("You are helpful.")
  .user(userQuestion)
  .render({ renderer: chatCompletions, tokenizer });
const response = await client.chat.completions.create({ model: "gpt-4o", messages });
```

### Responses (reasoning models)

```ts
import { responses } from "@fastpaca/cria/openai";
import { cria } from "@fastpaca/cria";

const input = await cria
  .prompt()
  .system("You are helpful.")
  .user(userQuestion)
  .render({ renderer: responses, tokenizer });
const response = await client.responses.create({ model: "o3", input });
```

### Provider

Use the `Provider` class to inject a model for components like `Summary` via the DSL `.provider()` scope.

```ts
import OpenAI from "openai";
import { Provider } from "@fastpaca/cria/openai";
import { cria } from "@fastpaca/cria";

const provider = new Provider(new OpenAI(), "gpt-4o");

const messages = await cria
  .prompt()
  .provider(provider, (p) =>
    p.summary(conversationHistory, { id: "history", store, priority: 2 })
  )
  .user(userQuestion)
  .render({ renderer: chatCompletions, tokenizer });
```

## Anthropic

```ts
import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@fastpaca/cria/anthropic";
import { cria } from "@fastpaca/cria";

const client = new Anthropic();
const { system, messages } = await cria
  .prompt()
  .system("You are helpful.")
  .user(userQuestion)
  .render({ renderer: anthropic, tokenizer });
const response = await client.messages.create({ model: "claude-sonnet-4-20250514", system, messages });
```

`Provider` works like OpenAI's, wrapping the Anthropic client and model for DSL `.provider()` scopes.

```ts
import Anthropic from "@anthropic-ai/sdk";
import { Provider } from "@fastpaca/cria/anthropic";
import { cria } from "@fastpaca/cria";

const provider = new Provider(new Anthropic(), "claude-sonnet-4-20250514");

const messages = await cria
  .prompt()
  .provider(provider, (p) =>
    p.summary(conversationHistory, { id: "history", store, priority: 2 })
  )
  .user(userQuestion)
  .render({ renderer: anthropic, tokenizer });
```

## Vercel AI SDK

```ts
import { renderer } from "@fastpaca/cria/ai-sdk";
import { cria } from "@fastpaca/cria";
import { generateText } from "ai";

const messages = await cria
  .prompt()
  .system("You are helpful.")
  .user(userQuestion)
  .render({ renderer, tokenizer });
const { text } = await generateText({ model, messages });
```

`Provider` provides a model for `Summary` or other AI-backed components.

```ts
import { Provider } from "@fastpaca/cria/ai-sdk";
import { openai } from "@ai-sdk/openai";
import { cria } from "@fastpaca/cria";

const provider = new Provider(openai("gpt-4o"));

const messages = await cria
  .prompt()
  .provider(provider, (p) =>
    p.summary(conversationHistory, { id: "history", store, priority: 2 })
  )
  .user(userQuestion)
  .render({ renderer, tokenizer });
```

`Messages` converts AI SDK UI messages into Cria elements, and `DEFAULT_PRIORITIES` gives a sensible starting point.

```ts
import { Messages, DEFAULT_PRIORITIES } from "@fastpaca/cria/ai-sdk";

<Messages messages={uiMessages} priorities={DEFAULT_PRIORITIES} />
```

## Optional JSX entry

If you prefer TSX, import components and the JSX runtime from `@fastpaca/cria/jsx` and point `jsxImportSource` there. The rendered output is the same IR; the DSL remains the primary API.

## Related

- [OpenAI Chat Completions](../examples/openai-chat-completions)
- [OpenAI Responses](../examples/openai-responses)
- [Anthropic](../examples/anthropic)
- [Vercel AI SDK](../examples/ai-sdk)
