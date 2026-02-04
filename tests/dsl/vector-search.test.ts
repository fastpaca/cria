import { cria, VectorDB } from "@fastpaca/cria";
import { describe, expect, test } from "vitest";
import { createTestProvider } from "../utils/plaintext";

const provider = createTestProvider({
  includeRolePrefix: true,
  joinMessagesWith: "\n\n",
});

describe("vector search", () => {
  interface TestDocument {
    title: string;
    content: string;
  }

  function createMockVectorStore(
    results: { key: string; score: number; data: TestDocument }[]
  ) {
    return {
      get: () => null,
      set: () => {
        /* no-op */
      },
      delete: () => false,
      search: () =>
        results.map((r) => ({
          key: r.key,
          score: r.score,
          entry: {
            data: r.data,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        })),
    };
  }

  test("vector search renders results at prompt level", async () => {
    const store = createMockVectorStore([
      {
        key: "doc-1",
        score: 0.95,
        data: { title: "Doc 1", content: "Content 1" },
      },
    ]);

    const vectors = new VectorDB({ store });

    const result = await cria
      .prompt()
      .use(vectors.search({ query: "search query", limit: 1 }))
      .render({ provider, budget: 10_000 });

    expect(result).toContain("user:");
    expect(result).toContain("score: 0.950");
    expect(result).toContain("Doc 1");
  });

  test("vector search renders results between messages", async () => {
    const store = createMockVectorStore([
      {
        key: "doc-1",
        score: 0.9,
        data: { title: "Result", content: "Found it" },
      },
    ]);

    const vectors = new VectorDB({ store });

    const result = await cria
      .prompt()
      .user("Here are the search results:")
      .use(vectors.search({ query: "test query", limit: 1 }))
      .render({ provider, budget: 10_000 });

    expect(result).toContain("user:");
    expect(result).toContain("Here are the search results:");
    expect(result).toContain("Result");
  });

  test("vector search handles empty results", async () => {
    const store = createMockVectorStore([]);
    const vectors = new VectorDB({ store });

    const result = await cria
      .prompt()
      .use(vectors.search({ query: "no matches", limit: 5 }))
      .render({ provider, budget: 10_000 });

    expect(result).toContain("Vector search returned no results");
  });
});
