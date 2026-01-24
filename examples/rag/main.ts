/**
 * Cria RAG (Retrieval-Augmented Generation) Example
 *
 * Shows how to use vectorSearch to inject relevant context into prompts.
 * In production, use ChromaStore, QdrantStore, or implement VectorMemory.
 */

import { cria } from "@fastpaca/cria";
import type { MemoryEntry, VectorMemory } from "@fastpaca/cria/memory";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";
const provider = createProvider(client, MODEL);

// --- Simple Demo Store (use ChromaStore/QdrantStore in production) ---

const documents = [
  { key: "capital", text: "Berlin is Germany's capital with ~3.7M people." },
  {
    key: "history",
    text: "Berlin was divided 1961-1989 and reunified in 1990.",
  },
  {
    key: "landmark",
    text: "The Brandenburg Gate is Berlin's most famous landmark.",
  },
];

// Minimal keyword-based store for demo (real stores use embeddings)
const store: VectorMemory<string> = {
  get: (key) => {
    const doc = documents.find((d) => d.key === key);
    return doc ? { data: doc.text, createdAt: 0, updatedAt: 0 } : null;
  },
  set: () => {
    // No-op for demo
  },
  delete: () => false,
  search: (query, opts) => {
    const q = query.toLowerCase();
    return documents
      .filter((d) => d.text.toLowerCase().includes(q))
      .slice(0, opts?.limit ?? 3)
      .map((d): { key: string; score: number; entry: MemoryEntry<string> } => ({
        key: d.key,
        score: 1,
        entry: { data: d.text, createdAt: 0, updatedAt: 0 },
      }));
  },
};

// --- Build the Prompt with Fluent DSL ---

const prompt = cria
  .prompt(provider)
  .system("Answer using the provided context. Be concise.")
  // vectorSearch retrieves relevant docs at render time
  .vectorSearch({ store, query: "Berlin", limit: 3 })
  .user("What can you tell me about Berlin?");

// --- Render and Call the Model ---

async function main(): Promise<void> {
  const budget = 500;
  const messages = await prompt.render({ budget });

  console.log("=== Messages ===");
  console.log(JSON.stringify(messages, null, 2));
  console.log(
    `\n=== Token count: ${provider.countTokens(messages)} / ${budget} ===\n`
  );

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages,
  });

  console.log("=== Answer ===");
  console.log(completion.choices[0]?.message?.content);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
