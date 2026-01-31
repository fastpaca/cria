/**
 * Cria + OpenAI Responses API Example
 *
 * Shows the fluent DSL with OpenAI's Responses API (for reasoning models).
 * Demonstrates budget-aware compaction with priorities.
 */

import { cria } from "@fastpaca/cria";
import { createResponsesProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";
const provider = createResponsesProvider(client, MODEL);

// --- Sample Data ---

const landmarkDetails = `Berlin Landmarks:
- Brandenburg Gate: 18th century neoclassical monument, symbol of reunification
- Berlin Wall Memorial: Preserved section with documentation center
- Museum Island: UNESCO site with 5 world-renowned museums
- Reichstag Building: German parliament with iconic glass dome
- Checkpoint Charlie: Famous Cold War crossing point`;

// --- Build the Prompt with Fluent DSL ---

const prompt = cria
  .prompt(provider)
  // System instructions (priority 1 = critical)
  .system("You are a helpful assistant. Give concise answers.")
  // Reference info: dropped if budget exceeded (priority 3 = lower)
  .omit(cria.prompt().assistant(`Reference:\n${landmarkDetails}`), {
    priority: 3,
    id: "reference",
  })
  // User question (priority 1 = critical)
  .user("What are the top 3 landmarks to visit in Berlin?");

// --- Render and Call the Model ---

async function main(): Promise<void> {
  const budget = 500;
  const output = await prompt.render({ budget });
  const { input: inputItems } = output;

  console.log("=== Response Input Items ===");
  console.log(JSON.stringify(inputItems, null, 2));
  console.log(
    `\n=== Token count: ${provider.countTokens(output)} / ${budget} ===\n`
  );

  const response = await client.responses.create({
    model: MODEL,
    input: inputItems,
  });

  console.log("=== OpenAI Response ===");
  console.log(response.output_text);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
