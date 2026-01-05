import { expect, test } from "vitest";
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

// Vector store tests removed (in-memory vector store not included)
