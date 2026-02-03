import {
  type SqliteDatabase,
  SqliteStore,
  type SqliteStoreOptions,
} from "@fastpaca/cria/memory/sqlite";
import { createClient } from "@libsql/client";
import { afterEach, expect, test } from "vitest";

const clients: SqliteDatabase[] = [];

const createStore = <T>(
  options?: SqliteStoreOptions
): { store: SqliteStore<T>; db: SqliteDatabase } => {
  const db = createClient({ url: ":memory:" });
  clients.push(db);
  const store = new SqliteStore<T>({ database: db, ...options });
  return { store, db };
};

const listTables = async (db: SqliteDatabase): Promise<string[]> => {
  const result = await db.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table'",
  });
  return result.rows.map((row) => (row as { name: string }).name);
};

afterEach(() => {
  for (const db of clients) {
    db.close();
  }
  clients.length = 0;
});

test("SqliteStore: get returns null for missing key", async () => {
  const { store } = createStore<string>();
  const result = await store.get("nonexistent");
  expect(result).toBeNull();
});

test("SqliteStore: set and get", async () => {
  const { store } = createStore<{ value: number }>();

  await store.set("key1", { value: 42 });

  const entry = await store.get("key1");
  expect(entry).not.toBeNull();
  expect(entry?.data).toEqual({ value: 42 });
  expect(entry?.createdAt).toBeGreaterThan(0);
  expect(entry?.updatedAt).toBeGreaterThan(0);
});

test("SqliteStore: set with metadata", async () => {
  const { store } = createStore<string>();

  await store.set("key", "value", { source: "test", priority: 1 });

  const entry = await store.get("key");
  expect(entry?.metadata).toEqual({ source: "test", priority: 1 });
});

test("SqliteStore: update preserves createdAt, updates updatedAt", async () => {
  const { store } = createStore<{ count: number }>();

  await store.set("key", { count: 1 });
  const first = await store.get("key");

  await new Promise((r) => setTimeout(r, 5));

  await store.set("key", { count: 2 });
  const second = await store.get("key");

  expect(second?.data.count).toBe(2);
  expect(second?.createdAt).toBe(first?.createdAt);
  expect(second?.updatedAt).toBeGreaterThanOrEqual(first?.updatedAt ?? 0);
});

test("SqliteStore: delete removes entry", async () => {
  const { store } = createStore<string>();

  await store.set("key", "value");
  expect(await store.get("key")).not.toBeNull();

  const deleted = await store.delete("key");
  expect(deleted).toBe(true);
  expect(await store.get("key")).toBeNull();
});

test("SqliteStore: delete returns false for missing key", async () => {
  const { store } = createStore<string>();
  const result = await store.delete("nonexistent");
  expect(result).toBe(false);
});

test("SqliteStore: uses custom table name", async () => {
  const { store, db } = createStore<string>({
    tableName: "my_custom_table",
  });

  await store.set("key", "value");

  const tables = await listTables(db);
  expect(tables).toContain("my_custom_table");
  expect(tables).not.toContain("cria_kv_store");
});

test("SqliteStore: supports schema-qualified table names", async () => {
  const { store, db } = createStore<string>({
    tableName: "main.my_table",
  });

  await store.set("key", "value");

  const tables = await listTables(db);
  expect(tables).toContain("my_table");
  expect(tables).not.toContain("cria_kv_store");
});

test("SqliteStore: uses default table name", async () => {
  const { store, db } = createStore<string>();

  await store.set("key", "value");

  const tables = await listTables(db);
  expect(tables).toContain("cria_kv_store");
});

test("SqliteStore: auto-creates table on first operation", async () => {
  const { store, db } = createStore<string>();

  const before = await listTables(db);
  expect(before).not.toContain("cria_kv_store");

  await store.get("nonexistent");

  const after = await listTables(db);
  expect(after).toContain("cria_kv_store");
});

test("SqliteStore: close closes the client", async () => {
  const { store, db } = createStore<string>();
  await store.get("key");
  store.close();
  await expect(db.execute("SELECT 1")).rejects.toThrow();
});
