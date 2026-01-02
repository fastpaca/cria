import { describe, expect, test } from "vitest";
import { InMemoryVectorStore } from "./in-memory-vector";
import { InMemoryStore } from "./key-value";

test("InMemoryStore: get returns null for missing key", () => {
  const store = new InMemoryStore<string>();
  expect(store.get("nonexistent")).toBeNull();
});

test("InMemoryStore: set and get", () => {
  const store = new InMemoryStore<{ value: number }>();

  store.set("key1", { value: 42 });

  const entry = store.get("key1");
  expect(entry).not.toBeNull();
  expect(entry?.data).toEqual({ value: 42 });
  expect(entry?.createdAt).toBeGreaterThan(0);
  expect(entry?.updatedAt).toBeGreaterThan(0);
});

test("InMemoryStore: set with metadata", () => {
  const store = new InMemoryStore<string>();

  store.set("key", "value", { source: "test", priority: 1 });

  const entry = store.get("key");
  expect(entry?.metadata).toEqual({ source: "test", priority: 1 });
});

test("InMemoryStore: update preserves createdAt, updates updatedAt", async () => {
  const store = new InMemoryStore<{ count: number }>();

  store.set("key", { count: 1 });
  const first = store.get("key");

  // Wait a tiny bit to ensure different timestamp
  await new Promise((r) => setTimeout(r, 5));

  store.set("key", { count: 2 });
  const second = store.get("key");

  expect(second?.data.count).toBe(2);
  expect(second?.createdAt).toBe(first?.createdAt);
  expect(second?.updatedAt).toBeGreaterThanOrEqual(first?.updatedAt ?? 0);
});

test("InMemoryStore: delete removes entry", () => {
  const store = new InMemoryStore<string>();

  store.set("key", "value");
  expect(store.get("key")).not.toBeNull();

  const deleted = store.delete("key");
  expect(deleted).toBe(true);
  expect(store.get("key")).toBeNull();
});

test("InMemoryStore: delete returns false for missing key", () => {
  const store = new InMemoryStore<string>();
  expect(store.delete("nonexistent")).toBe(false);
});

// =============================================================================
// InMemoryVectorStore tests
// =============================================================================

// Mock embedding function that produces simple vectors based on text content
function mockEmbed(text: string): Promise<number[]> {
  // Simple mock: use character codes to create a vector
  const vector: number[] = [];
  for (let i = 0; i < 4; i++) {
    const char = text.charCodeAt(i % text.length) || 0;
    vector.push(char / 255); // Normalize to 0-1 range
  }
  return Promise.resolve(vector);
}

describe("InMemoryVectorStore", () => {
  test("get returns null for missing key", () => {
    const store = new InMemoryVectorStore<string>({ embed: mockEmbed });
    expect(store.get("nonexistent")).toBeNull();
  });

  test("set and get", async () => {
    const store = new InMemoryVectorStore<{ value: number }>({
      embed: mockEmbed,
    });

    await store.set("key1", { value: 42 });

    const entry = store.get("key1");
    expect(entry).not.toBeNull();
    expect(entry?.data).toEqual({ value: 42 });
    expect(entry?.createdAt).toBeGreaterThan(0);
    expect(entry?.updatedAt).toBeGreaterThan(0);
  });

  test("set with metadata", async () => {
    const store = new InMemoryVectorStore<string>({ embed: mockEmbed });

    await store.set("key", "value", { source: "test", priority: 1 });

    const entry = store.get("key");
    expect(entry?.metadata).toEqual({ source: "test", priority: 1 });
  });

  test("delete removes entry", async () => {
    const store = new InMemoryVectorStore<string>({ embed: mockEmbed });

    await store.set("key", "value");
    expect(store.get("key")).not.toBeNull();

    const deleted = store.delete("key");
    expect(deleted).toBe(true);
    expect(store.get("key")).toBeNull();
  });

  test("search returns results sorted by similarity", async () => {
    const store = new InMemoryVectorStore<string>({ embed: mockEmbed });

    // Add documents
    await store.set("doc1", "hello world");
    await store.set("doc2", "hello there");
    await store.set("doc3", "goodbye world");

    // Search for "hello" - should prefer "hello world" and "hello there"
    const results = await store.search("hello");

    expect(results.length).toBeGreaterThan(0);
    // Results should be sorted by score descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  test("search respects limit option", async () => {
    const store = new InMemoryVectorStore<string>({ embed: mockEmbed });

    await store.set("doc1", "first document");
    await store.set("doc2", "second document");
    await store.set("doc3", "third document");

    const results = await store.search("document", { limit: 2 });

    expect(results).toHaveLength(2);
  });

  test("search respects threshold option", async () => {
    const store = new InMemoryVectorStore<string>({ embed: mockEmbed });

    await store.set("doc1", "hello");
    await store.set("doc2", "world");

    // With a very high threshold, we should get fewer results
    const highThreshold = await store.search("hello", { threshold: 0.99 });
    const lowThreshold = await store.search("hello", { threshold: 0 });

    expect(lowThreshold.length).toBeGreaterThanOrEqual(highThreshold.length);
  });

  test("search returns empty array when store is empty", async () => {
    const store = new InMemoryVectorStore<string>({ embed: mockEmbed });

    const results = await store.search("anything");

    expect(results).toEqual([]);
  });

  test("size returns number of entries", async () => {
    const store = new InMemoryVectorStore<string>({ embed: mockEmbed });

    expect(store.size()).toBe(0);

    await store.set("doc1", "first");
    expect(store.size()).toBe(1);

    await store.set("doc2", "second");
    expect(store.size()).toBe(2);
  });

  test("clear removes all entries", async () => {
    const store = new InMemoryVectorStore<string>({ embed: mockEmbed });

    await store.set("doc1", "first");
    await store.set("doc2", "second");

    store.clear();

    expect(store.size()).toBe(0);
    expect(store.get("doc1")).toBeNull();
  });
});
