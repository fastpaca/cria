/**
 * SQLite stores - KV + sqlite-vec in one example
 *
 * Requires: OPENAI_API_KEY + SQLITE_VEC_PATH (absolute path to vec0 without extension)
 */

import { cria, type StoredSummary } from "@fastpaca/cria";
import { SqliteStore } from "@fastpaca/cria/memory/sqlite";
import { SqliteVecStore } from "@fastpaca/cria/memory/sqlite-vec";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("Missing OPENAI_API_KEY.");
}

const openai = new OpenAI({ apiKey });
const provider = createProvider(openai, "gpt-4o-mini");
const embed = async (text: string) => {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0]?.embedding ?? [];
};

const vecPath = process.env.SQLITE_VEC_PATH;
if (!vecPath) {
  throw new Error("Missing SQLITE_VEC_PATH.");
}
const summaryStore = new SqliteStore<StoredSummary>({
  filename: "cria.sqlite",
});
const vectorStore = new SqliteVecStore<string>({
  filename: "cria.sqlite",
  dimensions: 1536,
  loadExtension: vecPath,
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
