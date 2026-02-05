import { cria } from "@fastpaca/cria";
import { SqliteVectorStore } from "@fastpaca/cria/memory/sqlite-vector";
import { type Client, createClient } from "@libsql/client";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createTestProvider } from "../utils/plaintext";

const provider = createTestProvider({
  includeRolePrefix: true,
  joinMessagesWith: "\n\n",
});

// Simple embedding: text length as single dimension
const embed = async (text: string): Promise<number[]> => [text.length];

const SCORE_PATTERN = /score: \d+\.\d+/;

const clients: Client[] = [];

const createStore = () => {
  const db = createClient({ url: ":memory:" });
  clients.push(db);
  return new SqliteVectorStore({
    database: db,
    embed,
    dimensions: 1,
    schema: z.object({ title: z.string(), content: z.string() }),
  });
};

afterEach(() => {
  for (const db of clients) {
    db.close();
  }
  clients.length = 0;
});

describe("vector search", () => {
  test("vector search renders results at prompt level", async () => {
    const store = createStore();
    await store.set("doc-1", { title: "Doc 1", content: "Content 1" });

    const vectors = cria.vectordb({ store });

    const result = await cria
      .prompt()
      .use(vectors({ query: "search query", limit: 1 }))
      .render({ provider, budget: 10_000 });

    expect(result).toContain("user:");
    expect(result).toMatch(SCORE_PATTERN);
    expect(result).toContain("Doc 1");
  });

  test("vector search renders results between messages", async () => {
    const store = createStore();
    await store.set("doc-1", { title: "Result", content: "Found it" });

    const vectors = cria.vectordb({ store });

    const result = await cria
      .prompt()
      .user("Here are the search results:")
      .use(vectors({ query: "test query", limit: 1 }))
      .render({ provider, budget: 10_000 });

    expect(result).toContain("user:");
    expect(result).toContain("Here are the search results:");
    expect(result).toContain("Result");
  });

  test("vector search handles empty results", async () => {
    const store = createStore();
    const vectors = cria.vectordb({ store });

    const result = await cria
      .prompt()
      .use(vectors({ query: "no matches", limit: 5 }))
      .render({ provider, budget: 10_000 });

    expect(result).toContain("Vector search returned no results");
  });
});
