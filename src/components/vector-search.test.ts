import { describe, expect, it } from "vitest";
import type { VectorMemory, VectorSearchResult } from "../memory";
import type { PromptPart } from "../types";
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

const PLAIN_TEXT_REGEX = /text parts/;

const expectedResults = `[1] (score: 0.950)
{
  "title": "First Document",
  "content": "This is the first document."
}

[2] (score: 0.820)
{
  "title": "Second Document",
  "content": "This is the second document."
}`;

describe("VectorSearch", () => {
  it("uses children as the query and renders results", async () => {
    const { store, getLastQuery, getLastOptions } =
      createMockStore(mockResults);

    const element = await VectorSearch({
      store,
      limit: 2,
      children: [{ type: "text", text: "Find docs about RAG" }],
    });

    expect(getLastQuery()).toBe("Find docs about RAG");
    expect(getLastOptions()).toEqual({ limit: 2 });
    expect(element.children[0]?.kind).toBe("message");
    const message = element.children[0];
    if (message?.kind === "message") {
      const part = message.children[0] as PromptPart | undefined;
      expect(part?.type).toBe("text");
      expect(part && "text" in part ? part.text : "").toBe(expectedResults);
    }
  });

  it("derives query from the last user message by default", async () => {
    const { store, getLastQuery } = createMockStore(mockResults);
    const messages = [
      { role: "assistant", content: "Previous answer" },
      { role: "user", content: "What is RAG?" },
    ];

    const element = await VectorSearch({ store, messages });

    expect(getLastQuery()).toBe("What is RAG?");
    const message = element.children[0];
    if (message?.kind === "message") {
      expect(message.children[0]?.type).toBe("text");
      expect(message.children[0]?.text).toBe(expectedResults);
    }
  });

  it("uses a custom extractor when provided", async () => {
    const { store, getLastQuery } = createMockStore(mockResults);
    const messages = [
      { role: "user", content: "ignore me" },
      { role: "assistant", content: "assistant reply" },
    ];

    const element = await VectorSearch({
      store,
      messages,
      extractQuery: () => "custom-query",
    });

    expect(getLastQuery()).toBe("custom-query");
    const message = element.children[0];
    if (message?.kind === "message") {
      expect(message.children[0]?.text).toBe(expectedResults);
    }
  });

  it("handles empty results without throwing", async () => {
    const { store } = createMockStore<TestDocument>([]);

    const element = await VectorSearch({
      store,
      query: "nothing here",
    });

    const message = element.children[0];
    if (message?.kind === "message") {
      expect(message.children[0]?.text).toBe(
        "Vector search returned no results."
      );
    }
  });

  it("throws when no query is available", async () => {
    const { store } = createMockStore<TestDocument>([]);

    await expect(VectorSearch({ store })).rejects.toThrow("no query provided");
  });

  it("uses custom formatter", async () => {
    const { store } = createMockStore(mockResults);

    const element = await VectorSearch({
      store,
      query: "test",
      formatResults: (results) => `Found ${results.length} results`,
    });

    const message = element.children[0];
    if (message?.kind === "message") {
      expect(message.children[0]?.text).toBe("Found 2 results");
    }
  });

  it("rejects non-text children", async () => {
    const { store } = createMockStore(mockResults);

    await expect(
      VectorSearch({
        store,
        children: [
          { type: "tool-call", toolCallId: "t1", toolName: "tool", input: {} },
        ],
      })
    ).rejects.toThrow(PLAIN_TEXT_REGEX);
  });
});
