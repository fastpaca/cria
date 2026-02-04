/**
 * RAG with Qdrant - real vector search integration
 *
 * Requires: Qdrant running locally (docker run -p 6333:6333 qdrant/qdrant)
 */

import { cria, VectorDB } from "@fastpaca/cria";
import { QdrantStore } from "@fastpaca/cria/memory/qdrant";
import { createProvider } from "@fastpaca/cria/openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";

const openai = new OpenAI();
const provider = createProvider(openai, "gpt-4o-mini");

const qdrant = new QdrantClient({ url: "http://localhost:6333" });

// Create collection and seed data (idempotent)
const collections = await qdrant.getCollections();
if (!collections.collections.some((c) => c.name === "docs")) {
  await qdrant.createCollection("docs", {
    vectors: { size: 1536, distance: "Cosine" },
  });
}

const embed = async (text: string) => {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0]?.embedding ?? [];
};

const store = new QdrantStore<string>({
  client: qdrant,
  collectionName: "docs",
  embed,
});

const vectors = new VectorDB({ store });

// Seed some documents (using UUIDs as Qdrant requires UUID or integer IDs)
await vectors.index({
  id: "550e8400-e29b-41d4-a716-446655440001",
  data: "Brandenburg Gate is Berlin's most famous landmark, a neoclassical monument built in the 18th century.",
});
await vectors.index({
  id: "550e8400-e29b-41d4-a716-446655440002",
  data: "The Berlin Wall Memorial preserves a section of the wall that divided the city from 1961 to 1989.",
});
await vectors.index({
  id: "550e8400-e29b-41d4-a716-446655440003",
  data: "Museum Island is a UNESCO World Heritage site with 5 world-renowned museums on the Spree river.",
});

const retrieval = vectors.search({ query: "Berlin landmarks", limit: 3 });

const prompt = cria
  .prompt(provider)
  .system("Answer using the provided context.")
  .use(retrieval)
  .user("What are the main landmarks in Berlin?");

const { messages } = await prompt.render({ budget: 1000 });
console.log("=== Messages ===");
console.log(JSON.stringify(messages, null, 2));

const response = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
});

console.log("\n=== Response ===");
console.log(response.choices[0]?.message?.content);
