/**
 * Cria + Vercel AI SDK Example
 *
 * Demonstrates cria's fluent DSL for building prompts with automatic
 * budget-aware compaction. Lower priority content gets dropped/truncated first.
 */

import { openai } from "@ai-sdk/openai";
import { cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/ai-sdk";
import { generateText } from "ai";

const model = openai("gpt-4o-mini");
const provider = createProvider(model);

// --- Sample Data ---

const referenceDoc = `Berlin is Germany's capital with ~3.7 million people.
It was divided during the Cold War and reunified in 1990.
Key landmarks: Brandenburg Gate, Berlin Wall Memorial, Museum Island.`;

const conversationHistory = [
  { role: "user" as const, content: "What's the capital of Germany?" },
  { role: "assistant" as const, content: "Berlin is the capital of Germany." },
  { role: "user" as const, content: "Tell me more about it." },
];

// --- Build the Prompt with Fluent DSL ---

// Build history as a prompt (for use with truncate)
const historyPrompt = conversationHistory.reduce(
  (p, msg) => p.message(msg.role, msg.content),
  cria.prompt()
);

const prompt = cria
  .prompt(provider)
  // System instructions (priority 1 = critical, never removed)
  .system("You are a helpful assistant. Be concise and direct.")
  // Reference docs: dropped entirely if budget exceeded (priority 3 = lower)
  .omit(cria.prompt().assistant(`Reference:\n${referenceDoc}`), {
    priority: 3,
    id: "context",
  })
  // History: truncated from start if budget exceeded (priority 2)
  .truncate(historyPrompt, {
    budget: 200,
    from: "start",
    priority: 2,
    id: "history",
  })
  // User question (priority 1 = critical, never removed)
  .user("What are Berlin's main landmarks?");

// --- Render and Call the Model ---

async function main(): Promise<void> {
  const budget = 500; // Small budget to demonstrate compaction
  const messages = await prompt.render({ budget });

  console.log("=== Rendered Messages ===");
  console.log(JSON.stringify(messages, null, 2));
  console.log(
    `\n=== Token count: ${provider.countTokens(messages)} / ${budget} ===\n`
  );

  const { text } = await generateText({ model, messages });

  console.log("=== AI Response ===");
  console.log(text);
}

main().catch(console.error);
