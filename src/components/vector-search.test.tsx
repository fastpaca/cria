import { describe, expect, it } from "vitest";
import type { VectorMemory, VectorSearchResult } from "../memory";
import type { CompletionMessage, PromptElement } from "../types";
import { VectorSearch } from "./vector-search";

// Mock data for testing
interface TestDocument {
  title: string;
  content: string;
}

const mockResults: VectorSearchResult<TestDocument>[] = [
  {
    key: "doc-1",
    score: 0.95,
    entry: {
      data: { title: "First Document", content: "This is the first document." },
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    },
  },
  {
    key: "doc-2",
    score: 0.82,
    entry: {
      data: {
        title: "Second Document",
        content: "This is the second document.",
      },
      createdAt: 1_700_000_001_000,
      updatedAt: 1_700_000_001_000,
    },
  },
];

function createMockStore<T>(results: VectorSearchResult<T>[]) {
  let lastQuery: string | undefined;
  let lastOptions: { limit?: number; threshold?: number } | undefined;

  const store: VectorMemory<T> = {
    get: () => null,
    set: () => {
      /* no-op */
    },
    delete: () => false,
    search: (query, options) => {
      lastQuery = query;
      lastOptions = options;
      return results;
    },
  };

  return {
    store,
    getLastQuery: () => lastQuery,
    getLastOptions: () => lastOptions,
  };
}

const PLAIN_TEXT_REGEX = /plain text/;

describe("VectorSearch", () => {
  it("uses children as the query and renders results", async () => {
    const { store, getLastQuery, getLastOptions } =
      createMockStore(mockResults);

    const element = await VectorSearch({
      store,
      limit: 2,
      children: ["Find docs about RAG"],
    });

    expect(getLastQuery()).toBe("Find docs about RAG");
    expect(getLastOptions()).toEqual({ limit: 2 });
    expect(element.children[0]).toContain("First Document");
  });

  it("derives query from the last user message by default", async () => {
    const { store, getLastQuery } = createMockStore(mockResults);
    const messages: CompletionMessage[] = [
      { role: "assistant", content: "Previous answer" },
      { role: "user", content: "What is RAG?" },
    ];

    const element = await VectorSearch({ store, messages });

    expect(getLastQuery()).toBe("What is RAG?");
    expect(element.children[0]).toContain("First Document");
  });

  it("uses a custom extractor when provided", async () => {
    const { store, getLastQuery } = createMockStore(mockResults);
    const messages: CompletionMessage[] = [
      { role: "user", content: "ignore me" },
      { role: "assistant", content: "assistant reply" },
    ];

    const element = await VectorSearch({
      store,
      messages,
      extractQuery: () => "custom-query",
    });

    expect(getLastQuery()).toBe("custom-query");
    expect(element.children[0]).toContain("First Document");
  });

  it("renders empty results message", async () => {
    const { store } = createMockStore<TestDocument>([]);

    const element = await VectorSearch({
      store,
      query: "nothing here",
    });

    expect(element.children[0]).toBe("[No relevant results found]");
  });

  it("renders placeholder when no query is available", async () => {
    const { store } = createMockStore<TestDocument>([]);

    const element = await VectorSearch({ store });

    expect(element.children[0]).toBe("[VectorSearch: no query provided]");
  });

  it("uses custom formatter", async () => {
    const { store } = createMockStore(mockResults);

    const element = await VectorSearch({
      store,
      query: "test",
      formatResults: (results) => `Found ${results.length} results`,
    });

    expect(element.children[0]).toBe("Found 2 results");
  });

  it("rejects non-text children", async () => {
    const { store } = createMockStore(mockResults);
    const badChild = { priority: 0, children: [] } as PromptElement;

    await expect(
      VectorSearch({
        store,
        children: [badChild],
      })
    ).rejects.toThrow(PLAIN_TEXT_REGEX);
  });
});
