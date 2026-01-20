# Quickstart

Your prompts deserve the same structure as your code. Cria turns prompts into composable components with explicit roles and strategies, and renders the same prompt tree to different providers.

## What Cria gives you

- Structure: a prompt tree instead of a long string.
- Composition: split prompts into reusable pieces and merge them like code.
- Portability: render the same prompt to OpenAI/Anthropic/AI SDK payloads.
- Optional compaction: keep big prompts within a budget with explicit strategies.

## Install

```bash
npm install @fastpaca/cria
```

## From a manual prompt string to Cria

If you currently build prompts like this:

```ts
const prompt = `
You are a helpful assistant.

User question:
${userQuestion}
`;
```

In Cria, you keep the same intent but make structure explicit:

```ts
import { cria } from "@fastpaca/cria";

const prompt = cria
  .prompt()
  .system("You are a helpful assistant.")
  .user(userQuestion);
```

## Run it in your current system (AI SDK example)

This is a complete runnable setup using the Vercel AI SDK + OpenAI. It renders your Cria prompt into `ModelMessage[]`, then calls the model.

```bash
npm install @fastpaca/cria ai @ai-sdk/openai
npm install -D tsx typescript
export OPENAI_API_KEY="sk-..."
```

Create `main.ts`:

```ts
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/ai-sdk";

const userQuestion = "Give me 3 crisp bullet points on compounding learning.";
const model = openai("gpt-4o-mini");
const provider = createProvider(model);

const prompt = cria
  .prompt(provider)
  .system("You are a helpful assistant.")
  .user(userQuestion);

const messages = await prompt.render({ budget: 8000 });
const { text } = await generateText({ model, messages });

console.log(text);
```

Run it:

```bash
npx tsx main.ts
```

## Refactor into composable pieces (the main win)

Once you have a prompt working, split it into small prompt blocks and merge them:

```ts
import { cria, type Prompt } from "@fastpaca/cria";

const systemRules = (): Prompt =>
  cria.prompt().system("You are a helpful assistant. Be concise.");

const appContext = (context: string): Prompt =>
  cria.prompt().section("context", (s) => s.assistant(context, { priority: 2 }));

const userRequest = (question: string): Prompt => cria.prompt().user(question);

const prompt = cria
  .merge(
    systemRules(),
    appContext("We build Cria: prompts as structured, composable code."),
    userRequest(userQuestion)
  )
  .provider(provider);
```

This is the workflow: start with a working prompt, then refactor into composable blocks that you can plug and play across your app.

## Budgets & compaction (optional)

When prompts grow, add a token `budget` so Cria compacts lower-importance content first.

Next: [Fit & compaction](how-to/fit-and-compaction.md)

## Next steps

- [Use with OpenAI](how-to/use-with-openai.md)
- [Use with Anthropic](how-to/use-with-anthropic.md)
- [Use with Vercel AI SDK](how-to/use-with-vercel-ai-sdk.md)
- [Prompt evaluation (LLM-as-a-judge)](how-to/prompt-evaluation.md)
- [RAG with VectorSearch](how-to/rag.md)
- [Summarize long history](how-to/summarize-history.md)
- [Components (reference)](components.md)
