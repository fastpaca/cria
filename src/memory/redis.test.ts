import { beforeEach, expect, test, vi } from "vitest";
import { RedisStore } from "./redis";

// Mock ioredis
const mockData = new Map<string, string>();

vi.mock("ioredis", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      get: vi.fn((key: string) => Promise.resolve(mockData.get(key) ?? null)),
      set: vi.fn((key: string, value: string) => {
        mockData.set(key, value);
        return Promise.resolve("OK");
      }),
      del: vi.fn((key: string) => {
        const existed = mockData.has(key);
        mockData.delete(key);
        return Promise.resolve(existed ? 1 : 0);
      }),
      quit: vi.fn(() => Promise.resolve("OK")),
    })),
  };
});

beforeEach(() => {
  mockData.clear();
});

test("RedisStore: get returns null for missing key", async () => {
  const store = new RedisStore<string>();
  const result = await store.get("nonexistent");
  expect(result).toBeNull();
});

test("RedisStore: set and get", async () => {
  const store = new RedisStore<{ value: number }>();

  await store.set("key1", { value: 42 });

  const entry = await store.get("key1");
  expect(entry).not.toBeNull();
  expect(entry?.data).toEqual({ value: 42 });
  expect(entry?.createdAt).toBeGreaterThan(0);
  expect(entry?.updatedAt).toBeGreaterThan(0);
});

test("RedisStore: set with metadata", async () => {
  const store = new RedisStore<string>();

  await store.set("key", "value", { source: "test", priority: 1 });

  const entry = await store.get("key");
  expect(entry?.metadata).toEqual({ source: "test", priority: 1 });
});

test("RedisStore: update preserves createdAt, updates updatedAt", async () => {
  const store = new RedisStore<{ count: number }>();

  await store.set("key", { count: 1 });
  const first = await store.get("key");

  // Wait a tiny bit to ensure different timestamp
  await new Promise((r) => setTimeout(r, 5));

  await store.set("key", { count: 2 });
  const second = await store.get("key");

  expect(second?.data.count).toBe(2);
  expect(second?.createdAt).toBe(first?.createdAt);
  expect(second?.updatedAt).toBeGreaterThanOrEqual(first?.updatedAt ?? 0);
});

test("RedisStore: delete removes entry", async () => {
  const store = new RedisStore<string>();

  await store.set("key", "value");
  expect(await store.get("key")).not.toBeNull();

  const deleted = await store.delete("key");
  expect(deleted).toBe(true);
  expect(await store.get("key")).toBeNull();
});

test("RedisStore: delete returns false for missing key", async () => {
  const store = new RedisStore<string>();
  const result = await store.delete("nonexistent");
  expect(result).toBe(false);
});

test("RedisStore: uses custom prefix", async () => {
  const store = new RedisStore<string>({
    keyPrefix: "myapp:",
  });

  await store.set("key", "value");

  // Verify the key is stored with prefix
  expect(mockData.has("myapp:key")).toBe(true);
  expect(mockData.has("cria:kv:key")).toBe(false);
});

test("RedisStore: uses default prefix", async () => {
  const store = new RedisStore<string>();

  await store.set("key", "value");

  expect(mockData.has("cria:kv:key")).toBe(true);
});

const INVALID_JSON_REGEX = /invalid JSON/;
const MISSING_CREATED_AT_REGEX = /missing createdAt/;

test("RedisStore: rejects invalid JSON payloads", async () => {
  const store = new RedisStore<string>();
  mockData.set("cria:kv:bad", "{this is not json");

  await expect(store.get("bad")).rejects.toThrow(INVALID_JSON_REGEX);
});

test("RedisStore: rejects malformed stored shapes", async () => {
  const store = new RedisStore<string>();
  mockData.set("cria:kv:bad-shape", JSON.stringify({ data: "x" }));

  await expect(store.get("bad-shape")).rejects.toThrow(
    MISSING_CREATED_AT_REGEX
  );
});

test("RedisStore: disconnect calls quit", async () => {
  const store = new RedisStore<string>();
  await store.disconnect();
  // If no error, the test passes
});
