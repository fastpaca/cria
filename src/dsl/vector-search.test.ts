import { describe, expect, test } from "vitest";
import { createTestProvider } from "../testing/plaintext";
import { cria } from "./index";

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

  test("vectorSearch renders results at prompt level", async () => {
    const store = createMockVectorStore([
      {
        key: "doc-1",
        score: 0.95,
        data: { title: "Doc 1", content: "Content 1" },
      },
    ]);

    const result = await cria
      .prompt()
      .vectorSearch({
        store,
        query: "search query",
        limit: 1,
      })
      .render({ provider, budget: 10_000 });

    expect(result).toContain("user:");
    expect(result).toContain("score: 0.950");
    expect(result).toContain("Doc 1");
  });

  test("vectorSearch renders results inside message", async () => {
    const store = createMockVectorStore([
      {
        key: "doc-1",
        score: 0.9,
        data: { title: "Result", content: "Found it" },
      },
    ]);

    const result = await cria
      .prompt()
      .user((m) =>
        m.append("Here are the search results:\n").vectorSearch({
          store,
          query: "test query",
          limit: 1,
        })
      )
      .render({ provider, budget: 10_000 });

    expect(result).toContain("user:");
    expect(result).toContain("Here are the search results:");
    expect(result).toContain("Result");
  });

  test("vectorSearch handles empty results", async () => {
    const store = createMockVectorStore([]);

    const result = await cria
      .prompt()
      .vectorSearch({
        store,
        query: "no matches",
        limit: 5,
      })
      .render({ provider, budget: 10_000 });

    expect(result).toContain("Vector search returned no results");
  });
});
