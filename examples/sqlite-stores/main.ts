/**
 * SQLite stores - KV + sqlite-vec in one example
 *
 * Requires: SQLITE_VEC_PATH (path to vec0 extension) + OPENAI_API_KEY
 */

import { cria, type StoredSummary } from "@fastpaca/cria";
import { SqliteStore } from "@fastpaca/cria/memory/sqlite";
import { SqliteVecStore } from "@fastpaca/cria/memory/sqlite-vec";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const openai = new OpenAI();
const provider = createProvider(openai, "gpt-4o-mini");
const embed = async (text: string) => {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0]?.embedding ?? [];
};

const summaryStore = new SqliteStore<StoredSummary>({
  filename: "cria.sqlite",
});
const vectorStore = new SqliteVecStore<string>({
  filename: "cria.sqlite",
  dimensions: 1536,
  loadExtension: process.env.SQLITE_VEC_PATH ?? "/path/to/vec0",
  embed,
});

await vectorStore.set("doc-1", "Brandenburg Gate is Berlin's landmark.");
await vectorStore.set("doc-2", "Museum Island hosts world-class museums.");

const history = cria
  .prompt()
  .user("I'm visiting Berlin.")
  .assistant("Great choice!");

const prompt = cria
  .prompt(provider)
  .summary(history, { id: "berlin", store: summaryStore })
  .vectorSearch({ store: vectorStore, query: "Berlin landmarks", limit: 2 })
  .user("Plan a one-day itinerary.");

const { messages } = await prompt.render({ budget: 300 });
const response = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
});

console.log(response.choices[0]?.message?.content);

summaryStore.close();
vectorStore.close();
