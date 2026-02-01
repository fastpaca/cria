/**
 * Cria Summary Example
 *
 * Shows how to use summary() for progressive conversation summarization.
 * When the prompt exceeds budget, older content is summarized and cached.
 */

import { cria, InMemoryStore, type StoredSummary } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";
const provider = createProvider(client, MODEL);

// Summary cache (use RedisStore or PostgresStore in production)
const summaryStore = new InMemoryStore<StoredSummary>();

// --- Sample Conversation History ---

const conversationHistory = [
  { role: "user" as const, content: "I'm planning a trip to Berlin." },
  {
    role: "assistant" as const,
    content: "Great choice! Berlin has rich history and culture.",
  },
  { role: "user" as const, content: "What neighborhoods should I stay in?" },
  {
    role: "assistant" as const,
    content: "Prenzlauer Berg and Kreuzberg are popular.",
  },
  { role: "user" as const, content: "What are the must-see historical sites?" },
  {
    role: "assistant" as const,
    content: "Brandenburg Gate, Berlin Wall Memorial, Museum Island.",
  },
];

// Build history as a prompt (for use with summary)
const historyPrompt = conversationHistory.reduce(
  (p, msg) => p.message(msg.role, msg.content),
  cria.prompt()
);

// --- Build the Prompt with Fluent DSL ---

const prompt = cria
  .prompt(provider)
  .system("You are a helpful travel assistant. Be concise.")
  // History wrapped in summary - gets summarized when over budget
  .summary(historyPrompt, {
    id: "conversation-summary",
    store: summaryStore,
    priority: 2,
  })
  .user("What's a good 1-day itinerary for Berlin?");

// --- Render and Call the Model ---

async function main(): Promise<void> {
  const budget = 300; // Small budget to trigger summarization
  const output = await prompt.render({ budget });
  const { messages } = output;

  console.log("=== Rendered messages ===");
  console.log(JSON.stringify(messages, null, 2));
  console.log(
    `\n=== Token count: ${provider.countTokens(output)} / ${budget} ===\n`
  );

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages,
  });

  console.log("=== Assistant response ===");
  console.log(completion.choices[0]?.message?.content);

  // Show cached summary (persisted across renders)
  const cached = summaryStore.get("conversation-summary");
  if (cached) {
    console.log("\n=== Cached summary ===");
    console.log(cached.data.content);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
