import { expect, test } from "vitest";
import { createMemory } from "./in-memory";

test("createMemory: basic get/set operations", async () => {
  const memory = createMemory<{ value: number }>();

  expect(await memory.get("nonexistent")).toBeNull();

  await memory.set("key1", { value: 42 });

  const entry = await memory.get("key1");
  expect(entry).not.toBeNull();
  expect(entry?.data).toEqual({ value: 42 });
  expect(entry?.createdAt).toBeGreaterThan(0);
  expect(entry?.updatedAt).toBeGreaterThan(0);
});

test("createMemory: has() checks existence", async () => {
  const memory = createMemory<string>();

  expect(await memory.has("missing")).toBe(false);

  await memory.set("exists", "hello");

  expect(await memory.has("exists")).toBe(true);
  expect(await memory.has("missing")).toBe(false);
});

test("createMemory: delete() removes entries", async () => {
  const memory = createMemory<string>();

  await memory.set("key", "value");
  expect(await memory.has("key")).toBe(true);

  const deleted = await memory.delete("key");
  expect(deleted).toBe(true);
  expect(await memory.has("key")).toBe(false);

  // Delete non-existent returns false
  const notDeleted = await memory.delete("key");
  expect(notDeleted).toBe(false);
});

test("createMemory: update preserves createdAt, updates updatedAt", async () => {
  const memory = createMemory<{ count: number }>();

  await memory.set("key", { count: 1 });
  const first = await memory.get("key");

  // Wait a tiny bit to ensure different timestamp
  await new Promise((r) => setTimeout(r, 5));

  await memory.set("key", { count: 2 });
  const second = await memory.get("key");

  expect(second?.data.count).toBe(2);
  expect(second?.createdAt).toBe(first?.createdAt);
  expect(second?.updatedAt).toBeGreaterThanOrEqual(first?.updatedAt ?? 0);
});

test("createMemory: set with metadata", async () => {
  const memory = createMemory<string>();

  await memory.set("key", "value", { source: "test", priority: 1 });

  const entry = await memory.get("key");
  expect(entry?.metadata).toEqual({ source: "test", priority: 1 });
});

test("createMemory: list returns all entries", async () => {
  const memory = createMemory<number>();

  await memory.set("a", 1);
  await memory.set("b", 2);
  await memory.set("c", 3);

  const { entries, nextCursor } = await memory.list();

  expect(entries.length).toBe(3);
  expect(entries.map((e) => e.key)).toEqual(["a", "b", "c"]);
  expect(entries.map((e) => e.entry.data)).toEqual([1, 2, 3]);
  expect(nextCursor).toBeNull();
});

test("createMemory: list with prefix filter", async () => {
  const memory = createMemory<string>();

  await memory.set("user:1", "alice");
  await memory.set("user:2", "bob");
  await memory.set("session:abc", "active");

  const { entries } = await memory.list({ prefix: "user:" });

  expect(entries.length).toBe(2);
  expect(entries.map((e) => e.key)).toEqual(["user:1", "user:2"]);
});

test("createMemory: list with limit", async () => {
  const memory = createMemory<number>();

  for (let i = 0; i < 10; i++) {
    await memory.set(`key-${i.toString().padStart(2, "0")}`, i);
  }

  const { entries, nextCursor } = await memory.list({ limit: 3 });

  expect(entries.length).toBe(3);
  expect(entries.map((e) => e.entry.data)).toEqual([0, 1, 2]);
  expect(nextCursor).toBe("key-02");
});

test("createMemory: list with cursor pagination", async () => {
  const memory = createMemory<number>();

  for (let i = 0; i < 5; i++) {
    await memory.set(`k${i}`, i);
  }

  // First page
  const page1 = await memory.list({ limit: 2 });
  expect(page1.entries.map((e) => e.entry.data)).toEqual([0, 1]);
  expect(page1.nextCursor).toBe("k1");

  // Second page
  const page2 = await memory.list({
    limit: 2,
    cursor: page1.nextCursor ?? undefined,
  });
  expect(page2.entries.map((e) => e.entry.data)).toEqual([2, 3]);
  expect(page2.nextCursor).toBe("k3");

  // Third page (last)
  const page3 = await memory.list({
    limit: 2,
    cursor: page2.nextCursor ?? undefined,
  });
  expect(page3.entries.map((e) => e.entry.data)).toEqual([4]);
  expect(page3.nextCursor).toBeNull();
});

test("createMemory: clear removes all entries", async () => {
  const memory = createMemory<string>();

  await memory.set("a", "1");
  await memory.set("b", "2");
  expect(await memory.size()).toBe(2);

  await memory.clear();
  expect(await memory.size()).toBe(0);
  expect(await memory.get("a")).toBeNull();
});

test("createMemory: size returns entry count", async () => {
  const memory = createMemory<string>();

  expect(await memory.size()).toBe(0);

  await memory.set("a", "1");
  expect(await memory.size()).toBe(1);

  await memory.set("b", "2");
  expect(await memory.size()).toBe(2);

  await memory.delete("a");
  expect(await memory.size()).toBe(1);
});
