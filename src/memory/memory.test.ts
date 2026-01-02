import { expect, test } from "vitest";
import { InMemoryStore } from "./key-value";

test("InMemoryStore: basic get/set operations", () => {
  const store = new InMemoryStore<{ value: number }>();

  expect(store.get("nonexistent")).toBeNull();

  store.set("key1", { value: 42 });

  const entry = store.get("key1");
  expect(entry).not.toBeNull();
  expect(entry?.data).toEqual({ value: 42 });
  expect(entry?.createdAt).toBeGreaterThan(0);
  expect(entry?.updatedAt).toBeGreaterThan(0);
});

test("InMemoryStore: has() checks existence", () => {
  const store = new InMemoryStore<string>();

  expect(store.has("missing")).toBe(false);

  store.set("exists", "hello");

  expect(store.has("exists")).toBe(true);
  expect(store.has("missing")).toBe(false);
});

test("InMemoryStore: delete() removes entries", () => {
  const store = new InMemoryStore<string>();

  store.set("key", "value");
  expect(store.has("key")).toBe(true);

  const deleted = store.delete("key");
  expect(deleted).toBe(true);
  expect(store.has("key")).toBe(false);

  // Delete non-existent returns false
  const notDeleted = store.delete("key");
  expect(notDeleted).toBe(false);
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

test("InMemoryStore: set with metadata", () => {
  const store = new InMemoryStore<string>();

  store.set("key", "value", { source: "test", priority: 1 });

  const entry = store.get("key");
  expect(entry?.metadata).toEqual({ source: "test", priority: 1 });
});

test("InMemoryStore: list returns all entries", () => {
  const store = new InMemoryStore<number>();

  store.set("a", 1);
  store.set("b", 2);
  store.set("c", 3);

  const entries = store.list();

  expect(entries.length).toBe(3);
  expect(entries.map((e) => e.entry.data)).toEqual([1, 2, 3]);
});

test("InMemoryStore: list with prefix filter", () => {
  const store = new InMemoryStore<string>();

  store.set("user:1", "alice");
  store.set("user:2", "bob");
  store.set("session:abc", "active");

  const entries = store.list("user:");

  expect(entries.length).toBe(2);
  expect(entries.map((e) => e.key)).toEqual(["user:1", "user:2"]);
});

test("InMemoryStore: clear removes all entries", () => {
  const store = new InMemoryStore<string>();

  store.set("a", "1");
  store.set("b", "2");
  expect(store.size()).toBe(2);

  store.clear();
  expect(store.size()).toBe(0);
  expect(store.get("a")).toBeNull();
});

test("InMemoryStore: size returns entry count", () => {
  const store = new InMemoryStore<string>();

  expect(store.size()).toBe(0);

  store.set("a", "1");
  expect(store.size()).toBe(1);

  store.set("b", "2");
  expect(store.size()).toBe(2);

  store.delete("a");
  expect(store.size()).toBe(1);
});
