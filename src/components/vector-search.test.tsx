import { describe, expect, it } from "vitest";
import type { VectorMemory, VectorSearchResult } from "../memory";
import type { CompletionMessage } from "../types";
import { searchAndRender, VectorSearch, vectorSearch } from "./vector-search";

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

describe("VectorSearch", () => {
  it("renders search results with default formatter", () => {
    const element = VectorSearch({ results: mockResults });

    expect(element.priority).toBe(0);
    expect(element.children).toHaveLength(1);
    expect(element.children[0]).toContain("[1] (score: 0.950)");
    expect(element.children[0]).toContain("First Document");
    expect(element.children[0]).toContain("[2] (score: 0.820)");
    expect(element.children[0]).toContain("Second Document");
  });

  it("renders empty results message", () => {
    const element = VectorSearch({ results: [] });

    expect(element.children).toHaveLength(1);
    expect(element.children[0]).toBe("[No relevant results found]");
  });

  it("uses custom formatter", () => {
    const element = VectorSearch({
      results: mockResults,
      formatResults: (results) =>
        results.map((r) => `• ${r.entry.data.title}`).join("\n"),
    });

    expect(element.children[0]).toBe("• First Document\n• Second Document");
  });

  it("respects priority setting", () => {
    const element = VectorSearch({ results: mockResults, priority: 5 });

    expect(element.priority).toBe(5);
  });

  it("includes id when provided", () => {
    const element = VectorSearch({
      results: mockResults,
      id: "test-search",
    });

    expect(element.id).toBe("test-search");
  });

  it("handles string data directly", () => {
    const stringResults: VectorSearchResult<string>[] = [
      {
        key: "str-1",
        score: 0.9,
        entry: {
          data: "Plain text content",
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        },
      },
    ];

    const element = VectorSearch({ results: stringResults });

    expect(element.children[0]).toContain("Plain text content");
    expect(element.children[0]).not.toContain('"'); // String data shouldn't be JSON-escaped
  });
});

describe("searchAndRender", () => {
  // Create a mock VectorMemory store
  function createMockStore<T>(
    results: VectorSearchResult<T>[]
  ): VectorMemory<T> {
    return {
      get: () => null,
      set: () => {
        /* no-op for mock */
      },
      delete: () => false,
      search: () => results,
    };
  }

  it("performs search and renders results", async () => {
    const store = createMockStore(mockResults);

    const element = await searchAndRender({
      query: "test query",
      store,
    });

    expect(element.children).toHaveLength(1);
    expect(element.children[0]).toContain("First Document");
  });

  it("passes search options to store", async () => {
    let capturedOptions: { limit?: number; threshold?: number } | undefined;

    const store: VectorMemory<TestDocument> = {
      get: () => null,
      set: () => {
        /* no-op for mock */
      },
      delete: () => false,
      search: (_query, options) => {
        capturedOptions = options;
        return [];
      },
    };

    await searchAndRender({
      query: "test",
      store,
      limit: 10,
      threshold: 0.8,
    });

    expect(capturedOptions).toEqual({ limit: 10, threshold: 0.8 });
  });

  it("applies custom formatter", async () => {
    const store = createMockStore(mockResults);

    const element = await searchAndRender({
      query: "test",
      store,
      formatResults: (results) => `Found ${results.length} results`,
    });

    expect(element.children[0]).toBe("Found 2 results");
  });

  it("sets priority and id on element", async () => {
    const store = createMockStore(mockResults);

    const element = await searchAndRender({
      query: "test",
      store,
      priority: 3,
      id: "my-search",
    });

    expect(element.priority).toBe(3);
    expect(element.id).toBe("my-search");
  });
});

describe("vectorSearch", () => {
  // Create a mock VectorMemory store that captures the query
  function createMockStoreWithCapture<T>(results: VectorSearchResult<T>[]) {
    let capturedQuery: string | undefined;
    const store: VectorMemory<T> = {
      get: () => null,
      set: () => {
        /* no-op for mock */
      },
      delete: () => false,
      search: (query) => {
        capturedQuery = query;
        return results;
      },
    };
    return { store, getCapturedQuery: () => capturedQuery };
  }

  describe("query patterns", () => {
    it("uses explicit query string", async () => {
      const { store, getCapturedQuery } =
        createMockStoreWithCapture(mockResults);

      await vectorSearch({
        store,
        query: "explicit query",
      });

      expect(getCapturedQuery()).toBe("explicit query");
    });

    it("uses children as query", async () => {
      const { store, getCapturedQuery } =
        createMockStoreWithCapture(mockResults);

      await vectorSearch({
        store,
        children: ["Find docs about: ", "TypeScript"],
      });

      expect(getCapturedQuery()).toBe("Find docs about: TypeScript");
    });

    it("uses last user message from messages", async () => {
      const { store, getCapturedQuery } =
        createMockStoreWithCapture(mockResults);
      const messages: CompletionMessage[] = [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "First question" },
        { role: "assistant", content: "First answer" },
        { role: "user", content: "Second question" },
      ];

      await vectorSearch({
        store,
        messages,
      });

      expect(getCapturedQuery()).toBe("Second question");
    });

    it("query takes precedence over children", async () => {
      const { store, getCapturedQuery } =
        createMockStoreWithCapture(mockResults);

      await vectorSearch({
        store,
        query: "explicit wins",
        children: ["children ignored"],
      });

      expect(getCapturedQuery()).toBe("explicit wins");
    });

    it("children takes precedence over messages", async () => {
      const { store, getCapturedQuery } =
        createMockStoreWithCapture(mockResults);
      const messages: CompletionMessage[] = [
        { role: "user", content: "message ignored" },
      ];

      await vectorSearch({
        store,
        children: ["children wins"],
        messages,
      });

      expect(getCapturedQuery()).toBe("children wins");
    });
  });

  describe("custom query extractor", () => {
    it("uses custom extractQuery function", async () => {
      const { store, getCapturedQuery } =
        createMockStoreWithCapture(mockResults);
      const messages: CompletionMessage[] = [
        { role: "user", content: "First" },
        { role: "user", content: "Second" },
        { role: "user", content: "Third" },
      ];

      await vectorSearch({
        store,
        messages,
        extractQuery: (msgs) =>
          msgs
            .filter((m) => m.role === "user")
            .map((m) => m.content)
            .join(" | "),
      });

      expect(getCapturedQuery()).toBe("First | Second | Third");
    });
  });

  describe("edge cases", () => {
    it("returns empty results when no query is provided", async () => {
      const { store, getCapturedQuery } =
        createMockStoreWithCapture(mockResults);

      const element = await vectorSearch({ store });

      expect(getCapturedQuery()).toBeUndefined();
      expect(element.children[0]).toBe("[No relevant results found]");
    });

    it("returns empty results when messages has no user messages", async () => {
      const { store, getCapturedQuery } =
        createMockStoreWithCapture(mockResults);
      const messages: CompletionMessage[] = [
        { role: "system", content: "System message" },
        { role: "assistant", content: "Assistant message" },
      ];

      const element = await vectorSearch({ store, messages });

      expect(getCapturedQuery()).toBeUndefined();
      expect(element.children[0]).toBe("[No relevant results found]");
    });

    it("handles empty children array", async () => {
      const { store, getCapturedQuery } =
        createMockStoreWithCapture(mockResults);

      const element = await vectorSearch({
        store,
        children: [],
      });

      expect(getCapturedQuery()).toBeUndefined();
      expect(element.children[0]).toBe("[No relevant results found]");
    });
  });

  describe("options passthrough", () => {
    it("passes limit and threshold to store", async () => {
      let capturedOptions: { limit?: number; threshold?: number } | undefined;
      const store: VectorMemory<TestDocument> = {
        get: () => null,
        set: () => {
          /* no-op */
        },
        delete: () => false,
        search: (_query, options) => {
          capturedOptions = options;
          return [];
        },
      };

      await vectorSearch({
        store,
        query: "test",
        limit: 10,
        threshold: 0.8,
      });

      expect(capturedOptions).toEqual({ limit: 10, threshold: 0.8 });
    });

    it("applies custom formatter", async () => {
      const { store } = createMockStoreWithCapture(mockResults);

      const element = await vectorSearch({
        store,
        query: "test",
        formatResults: (results) => `Found ${results.length} results`,
      });

      expect(element.children[0]).toBe("Found 2 results");
    });

    it("sets priority and id on element", async () => {
      const { store } = createMockStoreWithCapture(mockResults);

      const element = await vectorSearch({
        store,
        query: "test",
        priority: 5,
        id: "vector-context",
      });

      expect(element.priority).toBe(5);
      expect(element.id).toBe("vector-context");
    });
  });
});
