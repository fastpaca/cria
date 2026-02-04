import {
  cria,
  type PromptPlugin,
  type StoredSummary,
  Summary,
  VectorDB,
} from "@fastpaca/cria";
import { InMemoryStore } from "@fastpaca/cria/memory";
import { describe, expect, test } from "vitest";
import { createTestProvider } from "../utils/plaintext";

const provider = createTestProvider({
  includeRolePrefix: true,
  joinMessagesWith: "\n\n",
});

describe("prompt plugins", () => {
  test("use() inserts plugin content at call site", async () => {
    const plugin: PromptPlugin = {
      render: () => cria.prompt().user("Plugin A").user("Plugin B"),
    };

    const output = await cria
      .prompt()
      .system("System")
      .use(plugin)
      .user("Question")
      .render({ provider, budget: 1000 });

    expect(output).toBe(
      "system: System\n\nuser: Plugin A\n\nuser: Plugin B\n\nuser: Question"
    );
  });

  test("summary plugin writes when over budget", async () => {
    const store = new InMemoryStore<StoredSummary>();
    const summarizer = () => "S";

    const summaryPlugin = new Summary({
      id: "conv-summary",
      store,
      metadata: { sessionId: "s-1" },
      summarize: summarizer,
      priority: 1,
    }).extend(cria.prompt().user("x".repeat(200)));

    const summaryOutput = "system: S";
    const fullOutput = `user: ${"x".repeat(200)}`;
    const budget =
      provider.countTokens(fullOutput) > provider.countTokens(summaryOutput)
        ? provider.countTokens(summaryOutput)
        : Math.max(0, provider.countTokens(fullOutput) - 1);

    const output = await cria
      .prompt()
      .use(summaryPlugin)
      .render({ provider, budget });

    expect(output).toBe(summaryOutput);
    const entry = store.get("conv-summary");
    expect(entry?.data.content).toBe("S");
    expect(entry?.metadata).toEqual({ sessionId: "s-1" });
  });

  test("summary writeNow writes immediately", async () => {
    const store = new InMemoryStore<StoredSummary>();
    const summarizer = () => "Now";

    const summaryPlugin = new Summary({
      id: "conv-now",
      store,
      summarize: summarizer,
    }).extend(cria.prompt().user("Hello"));

    const result = await summaryPlugin.writeNow();

    expect(result).toBe("Now");
    const entry = store.get("conv-now");
    expect(entry?.data.content).toBe("Now");
  });

  test("vector search plugin renders results", async () => {
    const store = createMockVectorStore([
      {
        key: "doc-1",
        score: 0.95,
        data: { title: "Doc 1", content: "Content 1" },
      },
    ]);

    const vectors = new VectorDB({ store });
    const retrieval = vectors.search({ query: "search query", limit: 1 });

    const output = await cria
      .prompt()
      .use(retrieval)
      .render({ provider, budget: 10_000 });

    expect(output).toContain("Doc 1");
  });

  test("vector index shares formatter with index", async () => {
    const store = createMockStringVectorStore();
    const vectors = new VectorDB({
      store,
      format: (data: { title: string }) => `Title: ${data.title}`,
    });

    await vectors.index({
      id: "doc-1",
      data: { title: "Indexed" },
      metadata: { source: "test" },
    });

    const indexed = store.getLastSet();
    expect(indexed?.data).toBe("Title: Indexed");
    expect(indexed?.metadata).toEqual({ source: "test" });

    const output = await cria
      .prompt()
      .use(vectors.search({ query: "Indexed", limit: 1 }))
      .render({ provider, budget: 10_000 });

    expect(output).toContain("Title: Indexed");
  });
});

function createMockVectorStore<T>(
  results: { key: string; score: number; data: T }[]
) {
  return {
    get: () => null,
    set: () => {
      /* no-op */
    },
    delete: () => false,
    search: () =>
      results.map((result) => ({
        key: result.key,
        score: result.score,
        entry: {
          data: result.data,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      })),
  };
}

function createMockStringVectorStore() {
  let lastSet:
    | {
        key: string;
        data: string;
        metadata?: Record<string, unknown>;
      }
    | undefined;

  return {
    getLastSet: () => lastSet,
    get: () => null,
    set: (key: string, data: string, metadata?: Record<string, unknown>) => {
      lastSet = { key, data, metadata };
    },
    delete: () => false,
    search: () => {
      if (!lastSet) {
        return [];
      }
      return [
        {
          key: lastSet.key,
          score: 0.9,
          entry: {
            data: lastSet.data,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      ];
    },
  };
}
