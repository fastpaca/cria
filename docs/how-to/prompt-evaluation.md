# Prompt evaluation (LLM-as-a-judge)

Use `@fastpaca/cria/eval` to evaluate prompts with an LLM-as-a-judge pattern in tests and CI.

## Minimal pattern (AI SDK + OpenAI)

```ts
import { openai } from "@ai-sdk/openai";
import { c, cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/ai-sdk";
import { createJudge } from "@fastpaca/cria/eval";

const judge = createJudge({
  // The model you are testing (produces the response)
  target: createProvider(openai("gpt-4o-mini")),
  // A (potentially different) model that grades the response
  evaluator: createProvider(openai("gpt-4o-mini")),
  threshold: 0.8,
});

const prompt = await cria
  .prompt()
  .system("You are a helpful customer support agent.")
  .user("How do I update my payment method?")
  .build();

await judge(prompt).toPass(c`Helpfulness and accuracy in addressing the user's question`);
```

## Using it in Vitest

Real model calls often take 5–30 seconds. Set a longer timeout per test.

```ts
import { test } from "vitest";
import { openai } from "@ai-sdk/openai";
import { c, cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/ai-sdk";
import { createJudge } from "@fastpaca/cria/eval";

const judge = createJudge({
  target: createProvider(openai("gpt-4o-mini")),
  evaluator: createProvider(openai("gpt-4o-mini")),
});

test("prompt is helpful", async () => {
  const prompt = await cria
    .prompt()
    .system("You are a helpful assistant.")
    .user("Explain compounding learning in 3 bullet points.")
    .build();

  await judge(prompt).toPass(c`Helpfulness and clarity`);
}, 30_000);
```

## Notes

- The judge throws when the evaluation fails; this makes it work naturally with test runners.
- For deterministic results, prefer stable criteria and low-variance judge settings in your provider layer.
- Running evals in CI consumes tokens and may hit rate limits; start small and scale up.

