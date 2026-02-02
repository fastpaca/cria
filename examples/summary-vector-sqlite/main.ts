/**
 * Summary + Vector with SQLite (libSQL)
 *
 * Requires: OPENAI_API_KEY
 */

import { cria, type StoredSummary } from "@fastpaca/cria";
import { SqliteStore } from "@fastpaca/cria/memory/sqlite";
import { SqliteVectorStore } from "@fastpaca/cria/memory/sqlite-vector";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("Missing OPENAI_API_KEY.");
}

const client = new OpenAI({ apiKey });
const provider = createProvider(client, "gpt-4o-mini");

const embed = async (text: string): Promise<number[]> => {
  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });

  const embedding = response.data[0]?.embedding;
  if (!embedding) {
    throw new Error("Missing embedding.");
  }

  return embedding;
};

const dbFile = "cria.sqlite";
const summaryId = "travel-chat";

const summaryStore = new SqliteStore<StoredSummary>({
  filename: dbFile,
  tableName: "cria_summaries",
});

const vectorStore = new SqliteVectorStore<string>({
  filename: dbFile,
  tableName: "cria_vectors",
  dimensions: 1536,
  embed,
});

// Set RESET_SUMMARY=1 to drop only the summary cache entry.
const resetSummary = process.env.RESET_SUMMARY === "1";
if (resetSummary) {
  await summaryStore.delete(summaryId);
}

await vectorStore.set(
  "doc-1",
  "Brandenburg Gate is a landmark built in the 18th century."
);
await vectorStore.set(
  "doc-2",
  "The Berlin Wall Memorial preserves a section of the wall."
);
await vectorStore.set(
  "doc-3",
  "Museum Island is a UNESCO site with five museums."
);

const history = cria
  .prompt()
  .user("I'm planning a trip to Berlin.")
  .assistant("Great choice! Berlin is packed with history and culture.")
  .user("What neighborhoods should I stay in?")
  .assistant("Prenzlauer Berg and Kreuzberg are popular.");

const question = "What are the main landmarks in Berlin?";
const summaryOpts = {
  id: summaryId,
  store: summaryStore,
  priority: 2,
};
const searchOpts = {
  store: vectorStore,
  query: question,
  limit: 3,
};

const prompt = cria
  .prompt(provider)
  .system("Answer using the summary and the retrieved context.")
  .summary(history, summaryOpts)
  .vectorSearch(searchOpts)
  .user(question);

const { messages } = await prompt.render({ budget: 1000 });
const response = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
});

console.log(response.choices[0]?.message?.content);

summaryStore.close();
vectorStore.close();
