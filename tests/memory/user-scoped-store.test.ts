import type { VectorMemory } from "@fastpaca/cria/memory";
import {
  InMemoryStore,
  scopeKVStore,
  scopeVectorStore,
} from "@fastpaca/cria/memory";
import { describe, expect, test } from "vitest";

interface Doc {
  title: string;
}

describe("scopeKVStore", () => {
  test("prefixes keys and attaches metadata", async () => {
    const base = new InMemoryStore<{ content: string }>();
    const scoped = scopeKVStore(base, {
      userId: "user-1",
      sessionId: "sess-1",
    });

    await scoped.set("summary", { content: "Hello" }, { tag: "t1" });

    const entry = await base.get("user:user-1:session:sess-1:summary");
    expect(entry?.data.content).toBe("Hello");
    expect(entry?.metadata).toEqual({
      tag: "t1",
      userId: "user-1",
      sessionId: "sess-1",
    });

    const scopedEntry = await scoped.get("summary");
    expect(scopedEntry?.data.content).toBe("Hello");
  });
});

describe("scopeVectorStore", () => {
  test("filters search results to the scoped user", async () => {
    const base = new MockVectorStore<Doc>();

    const userA = scopeVectorStore(base, { userId: "user-a" });
    const userB = scopeVectorStore(base, { userId: "user-b" });

    await userA.set("doc-1", { title: "A" });
    await userB.set("doc-2", { title: "B" });

    const results = await userA.search("query", { limit: 10 });

    expect(results).toHaveLength(1);
    expect(results[0]?.key).toBe("doc-1");
    expect(results[0]?.entry.data.title).toBe("A");
  });
});

class MockVectorStore<T> implements VectorMemory<T> {
  private readonly entries = new Map<
    string,
    { data: T; metadata?: Record<string, unknown> }
  >();

  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    return {
      data: entry.data,
      createdAt: 0,
      updatedAt: 0,
      ...(entry.metadata ? { metadata: entry.metadata } : {}),
    };
  }

  set(key: string, data: T, metadata?: Record<string, unknown>) {
    this.entries.set(key, { data, ...(metadata ? { metadata } : {}) });
  }

  delete(key: string) {
    return this.entries.delete(key);
  }

  search(_query: string) {
    return Array.from(this.entries.entries()).map(([key, entry], index) => ({
      key,
      score: 1 - index * 0.01,
      entry: {
        data: entry.data,
        createdAt: 0,
        updatedAt: 0,
        ...(entry.metadata ? { metadata: entry.metadata } : {}),
      },
    }));
  }
}
