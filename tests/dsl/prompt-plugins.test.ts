import { cria, type PromptPlugin, type StoredSummary } from "@fastpaca/cria";
import { InMemoryStore } from "@fastpaca/cria/memory";
import { SqliteVectorStore } from "@fastpaca/cria/memory/sqlite-vector";
import { type Client, createClient } from "@libsql/client";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createFixedCompletionProvider,
  createTestProvider,
} from "../utils/plaintext";

const provider = createTestProvider({
  includeRolePrefix: true,
  joinMessagesWith: "\n\n",
});
const summaryProvider = createFixedCompletionProvider("S", {
  includeRolePrefix: true,
  joinMessagesWith: "\n\n",
});

// Simple embedding: text length as single dimension
const embed = async (text: string): Promise<number[]> => [text.length];

const clients: Client[] = [];

const createStore = <T>(schema: z.ZodType<T>) => {
  const db = createClient({ url: ":memory:" });
  clients.push(db);
  return new SqliteVectorStore<T>({
    database: db,
    embed,
    dimensions: 1,
    schema,
  });
};

afterEach(() => {
  for (const db of clients) {
    db.close();
  }
  clients.length = 0;
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

    const summaryPlugin = cria
      .summarizer({
        id: "conv-summary",
        store,
        metadata: { sessionId: "s-1" },
        priority: 1,
        provider: summaryProvider,
      })
      .plugin({ history: cria.prompt().user("x".repeat(200)) });

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
    const nowProvider = createFixedCompletionProvider("Now", {
      includeRolePrefix: true,
      joinMessagesWith: "\n\n",
    });

    const summaryPlugin = cria.summarizer({
      id: "conv-now",
      store,
      provider: nowProvider,
    });

    const result = await summaryPlugin.writeNow({
      history: cria.prompt().user("Hello"),
    });

    expect(result).toBe("Now");
    const entry = store.get("conv-now");
    expect(entry?.data.content).toBe("Now");
  });

  test("vector search plugin renders results", async () => {
    const store = createStore(
      z.object({ title: z.string(), content: z.string() })
    );
    await store.set("doc-1", { title: "Doc 1", content: "Content 1" });

    const vectors = cria.vectordb(store);
    const retrieval = vectors.plugin({ query: "search query", limit: 1 });

    const output = await cria
      .prompt()
      .use(retrieval)
      .render({ provider, budget: 10_000 });

    expect(output).toContain("Doc 1");
  });

  test("vector index stores data and metadata", async () => {
    const store = createStore(z.object({ title: z.string() }));
    const vectors = cria.vectordb(store);

    await vectors.index({
      id: "doc-1",
      data: { title: "Indexed" },
      metadata: { source: "test" },
    });

    const entry = await store.get("doc-1");
    expect(entry?.data).toEqual({ title: "Indexed" });
    expect(entry?.metadata).toEqual({ source: "test" });

    const output = await cria
      .prompt()
      .use(vectors.plugin({ query: "Indexed", limit: 1 }))
      .render({ provider, budget: 10_000 });

    expect(output).toContain('"title": "Indexed"');
  });
});
