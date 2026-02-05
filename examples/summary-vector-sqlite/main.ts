/**
 * Summary + Vector with SQLite (libSQL)
 *
 * Requires: OPENAI_API_KEY
 */

import { cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";
import { z } from "zod";

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

const summarizer = cria.summarizer({
  id: summaryId,
  store: { sqlite: { filename: dbFile, tableName: "cria_summaries" } },
  priority: 2,
  provider,
});

const vectors = cria.vectordb({
  store: {
    sqlite: {
      filename: dbFile,
      tableName: "cria_vectors",
      dimensions: 1536,
      embed,
      schema: z.string(),
    },
  },
});

await vectors.index({
  id: "doc-1",
  data: "Brandenburg Gate is a landmark built in the 18th century.",
});
await vectors.index({
  id: "doc-2",
  data: "The Berlin Wall Memorial preserves a section of the wall.",
});
await vectors.index({
  id: "doc-3",
  data: "Museum Island is a UNESCO site with five museums.",
});

const history = cria
  .prompt()
  .user("I'm planning a trip to Berlin.")
  .assistant("Great choice! Berlin is packed with history and culture.")
  .user("What neighborhoods should I stay in?")
  .assistant("Prenzlauer Berg and Kreuzberg are popular.");

const question = "What are the main landmarks in Berlin?";
const summary = summarizer({ history });
const retrieval = vectors({ query: question, limit: 3 });

const prompt = cria
  .prompt(provider)
  .system("Answer using the summary and the retrieved context.")
  .use(summary)
  .use(retrieval)
  .user(question);

const { messages } = await prompt.render({ budget: 1000 });
const response = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
});

console.log(response.choices[0]?.message?.content);
