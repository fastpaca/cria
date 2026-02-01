/**
 * Cria + OpenAI Chat Completions Example
 *
 * Shows the fluent DSL with budget-aware compaction.
 * Lower priority content (like optional context) gets dropped first.
 */

import { cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";
const provider = createProvider(client, MODEL);

// --- Sample Data ---

const detailedContext = `Berlin History:
- Founded in the 13th century
- Became capital of Prussia in 1701
- Heavily bombed in WWII
- Divided by the Berlin Wall 1961-1989
- Reunified as Germany's capital in 1990
- Today: ~3.7 million people, major cultural hub`;

// --- Build the Prompt with Fluent DSL ---

const prompt = cria
  .prompt(provider)
  // System instructions (priority 1 = critical)
  .system("You are a helpful assistant. Answer in bullet points.")
  // Detailed context: dropped if budget is tight (priority 3 = lower)
  .omit(cria.prompt().assistant(`Context:\n${detailedContext}`), {
    priority: 3,
    id: "context",
  })
  // User question (priority 1 = critical)
  .user("What are three key facts about Berlin?");

// --- Render and Call the Model ---

async function main(): Promise<void> {
  const budget = 500;
  const output = await prompt.render({ budget });
  const { messages } = output;

  console.log("=== Messages ===");
  console.log(JSON.stringify(messages, null, 2));
  console.log(
    `\n=== Token count: ${provider.countTokens(output)} / ${budget} ===\n`
  );

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages,
  });

  console.log("=== OpenAI Response ===");
  console.log(completion.choices[0]?.message?.content);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
