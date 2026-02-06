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
const embedByLength = async (text: string): Promise<number[]> => [text.length];

const docSchema = z.object({ title: z.string(), content: z.string() });

const SCORE_PATTERN = /score: \d+\.\d+/;

const clients: Client[] = [];

const createStore = <T>(
  schema: z.ZodType<T>,
  embed: (text: string) => Promise<number[]> = embedByLength
) => {
  const db = createClient({ url: ":memory:" });
  clients.push(db);
  return new SqliteVectorStore<T>({
    database: db,
    embed,
    dimensions: 1,
    schema,
  });
};

const createCountingEmbed = () => {
  let calls = 0;

  return {
    embed: (text: string): Promise<number[]> => {
      calls += 1;
      return Promise.resolve([text.length]);
    },
    getCalls: () => calls,
  };
};

afterEach(() => {
  for (const db of clients) {
    db.close();
  }
  clients.length = 0;
});

describe("vector search", () => {
  test("vector search renders results at prompt level", async () => {
    const store = createStore(docSchema);
    await store.set("doc-1", { title: "Doc 1", content: "Content 1" });

    const vectors = cria.vectordb(store);

    const result = await cria
      .prompt()
      .use(vectors.plugin({ query: "search query", limit: 1 }))
      .render({ provider, budget: 10_000 });

    expect(result).toContain("user:");
    expect(result).toContain("[1] (score:");
    expect(result).toMatch(SCORE_PATTERN);
    expect(result).toContain('"title": "Doc 1"');
    expect(result).toContain('"content": "Content 1"');
  });

  test("vector search renders results between messages", async () => {
    const store = createStore(docSchema);
    await store.set("doc-1", { title: "Result", content: "Found it" });

    const vectors = cria.vectordb(store);

    const result = await cria
      .prompt()
      .user("Here are the search results:")
      .use(vectors.plugin({ query: "test query", limit: 1 }))
      .render({ provider, budget: 10_000 });

    expect(result).toContain("user:");
    expect(result).toContain("Here are the search results:");
    expect(result).toContain("Result");
  });

  test("vector search handles empty results", async () => {
    const store = createStore(docSchema);
    const vectors = cria.vectordb(store);

    const result = await cria
      .prompt()
      .use(vectors.plugin({ query: "no matches", limit: 5 }))
      .render({ provider, budget: 10_000 });

    expect(result).toContain("Vector search returned no results");
  });

  test("vector search rejects empty query and does not search", async () => {
    const { embed, getCalls } = createCountingEmbed();
    const store = createStore(docSchema, embed);
    const vectors = cria.vectordb(store);

    await expect(
      cria
        .prompt()
        .use(vectors.plugin({ query: "   ", limit: 1 }))
        .render({ provider, budget: 10_000 })
    ).rejects.toThrow("VectorDB search requires a non-empty query.");
    expect(getCalls()).toBe(0);
  });

  test("vector search metadata filter scopes results", async () => {
    const store = createStore(z.string());
    await store.set("u1-a", "bravo!", { userId: "u-1" });
    await store.set("u1-b", "charlie", { userId: "u-1" });
    await store.set("u2-a", "alpha", { userId: "u-2" });

    const vectors = cria.vectordb(store);

    const output = await cria
      .prompt()
      .use(
        vectors.plugin({ query: "12345", limit: 2, filter: { userId: "u-1" } })
      )
      .render({ provider, budget: 10_000 });

    expect(output).toContain("bravo!");
    expect(output).toContain("charlie");
    expect(output).not.toContain("alpha");
  });

  test("vector search applies metadata filter before limit", async () => {
    const store = createStore(z.string());
    await store.set("u2-top", "alpha", { userId: "u-2" });
    await store.set("u1-match", "bravo!", { userId: "u-1" });
    await store.set("u1-backup", "charlie", { userId: "u-1" });

    const vectors = cria.vectordb(store);

    const output = await cria
      .prompt()
      .use(vectors.plugin({ query: "q", limit: 1, filter: { userId: "u-1" } }))
      .render({ provider, budget: 10_000 });

    expect(output).toContain("bravo!");
    expect(output).not.toContain("alpha");
  });

  test("vector search with zero limit skips backend search", async () => {
    const { embed, getCalls } = createCountingEmbed();
    const store = createStore(z.string(), embed);
    const vectors = cria.vectordb(store);

    const output = await cria
      .prompt()
      .use(vectors.plugin({ query: "valid query", limit: 0 }))
      .render({ provider, budget: 10_000 });

    expect(output).toContain("Vector search returned no results");
    expect(getCalls()).toBe(0);
  });
});
