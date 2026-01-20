/**
 * Cria + Anthropic Example
 *
 * Shows how cria works with Anthropic's API, including automatic
 * system message extraction and budget-aware compaction.
 */

import Anthropic from "@anthropic-ai/sdk";
import { cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/anthropic";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-haiku-4-5";
const provider = createProvider(client, MODEL);

// --- Sample Data ---

const backgroundContext = `Berlin is Germany's capital and largest city.
It was divided by the Berlin Wall from 1961-1989.
Key facts: Population ~3.7M, founded 13th century, reunified 1990.`;

// --- Build the Prompt with Fluent DSL ---

const prompt = cria
  .prompt(provider)
  // System rules (auto-extracted to Anthropic's separate 'system' param)
  .system("You are a concise assistant. Answer in 2-3 sentences.")
  // Optional context: dropped entirely if budget exceeded (priority 3)
  .omit(cria.prompt().assistant(`Background:\n${backgroundContext}`), {
    priority: 3,
    id: "context",
  })
  // User question (priority 1 = critical)
  .user("What happened to Berlin after WWII?");

// --- Render and Call the Model ---

async function main(): Promise<void> {
  const budget = 500;
  const rendered = await prompt.render({ budget });

  // Anthropic provider returns { system, messages } - system is auto-extracted
  const { system, messages } = rendered;

  console.log("=== Rendered ===");
  console.log("System:", system);
  console.log("Messages:", JSON.stringify(messages, null, 2));
  console.log(
    `\n=== Token count: ${provider.countTokens(rendered)} / ${budget} ===\n`
  );

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system,
    messages,
  });

  console.log("=== Anthropic Response ===");
  console.log(
    response.content[0]?.type === "text"
      ? response.content[0].text
      : response.content
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
