import { cria } from "@fastpaca/cria";
import type { VectorSearchOptions, VectorStore } from "@fastpaca/cria/memory";
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
    const store = createStore();
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
    const store = createStore();
    const vectors = cria.vectordb(store);

    const result = await cria
      .prompt()
      .use(vectors.plugin({ query: "no matches", limit: 5 }))
      .render({ provider, budget: 10_000 });

    expect(result).toContain("Vector search returned no results");
  });

  test("vector search rejects empty query and does not search", async () => {
    const store = new SpyVectorStore<{
      title: string;
      content: string;
    }>();
    const vectors = cria.vectordb(store);

    await expect(
      cria
        .prompt()
        .use(vectors.plugin({ query: "   ", limit: 1 }))
        .render({ provider, budget: 10_000 })
    ).rejects.toThrow("VectorDB search requires a non-empty query.");
    expect(store.searchCalls).toBe(0);
  });

  test("vector search metadata filter scopes results", async () => {
    const store = new FilterVectorStore();
    const vectors = cria.vectordb(store);

    const output = await cria
      .prompt()
      .use(vectors.plugin({ query: "q", limit: 1, filter: { userId: "u-1" } }))
      .render({ provider, budget: 10_000 });

    expect(output).toContain("match-u1");
    expect(output).not.toContain("other-u2");
  });

  test("vector search forwards metadata filter to store options", async () => {
    const store = new FilterVectorStore();
    const vectors = cria.vectordb(store);

    await cria
      .prompt()
      .use(vectors.plugin({ query: "q", limit: 1, filter: { userId: "u-1" } }))
      .render({ provider, budget: 10_000 });

    expect(store.lastLimit).toBe(1);
    expect(store.lastFilter).toEqual({ userId: "u-1" });
  });

  test("vector search with zero limit skips backend search", async () => {
    const store = new SpyVectorStore<{
      title: string;
      content: string;
    }>();
    const vectors = cria.vectordb(store);

    const output = await cria
      .prompt()
      .use(vectors.plugin({ query: "valid query", limit: 0 }))
      .render({ provider, budget: 10_000 });

    expect(output).toContain("Vector search returned no results");
    expect(store.searchCalls).toBe(0);
  });
});

class SpyVectorStore<T> implements VectorStore<T> {
  private readonly entries = new Map<string, T>();
  searchCalls = 0;

  get(key: string) {
    const value = this.entries.get(key);
    if (value === undefined) {
      return null;
    }
    return {
      data: value,
      createdAt: 0,
      updatedAt: 0,
    };
  }

  set(key: string, data: T) {
    this.entries.set(key, data);
  }

  delete(key: string) {
    return this.entries.delete(key);
  }

  search(_query: string) {
    this.searchCalls += 1;
    return [];
  }
}

class FilterVectorStore implements VectorStore<string> {
  lastLimit: number | undefined;
  lastFilter: VectorSearchOptions["filter"] | undefined;

  get(_key: string) {
    return null;
  }

  set(_key: string, _data: string, _metadata?: Record<string, unknown>) {
    return;
  }

  delete(_key: string) {
    return true;
  }

  search(_query: string, options?: VectorSearchOptions) {
    this.lastLimit = options?.limit;
    this.lastFilter = options?.filter;
    const all =
      options?.filter?.userId === "u-1"
        ? [
            {
              key: "d5",
              score: 0.95,
              entry: {
                data: "match-u1",
                createdAt: 0,
                updatedAt: 0,
                metadata: { userId: "u-1" },
              },
            },
          ]
        : [
            {
              key: "d1",
              score: 0.99,
              entry: {
                data: "other-u2",
                createdAt: 0,
                updatedAt: 0,
                metadata: { userId: "u-2" },
              },
            },
          ];

    if (options?.limit === undefined) {
      return all;
    }

    return all.slice(0, options.limit);
  }
}
