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

test("SqliteStore: set and get", async () => {
  const { store } = createStore<{ value: number }>();

  await store.set("key", { value: 42 });

  const entry = await store.get("key");
  expect(entry?.data).toEqual({ value: 42 });
  expect(entry?.createdAt).toBeGreaterThan(0);
  expect(entry?.updatedAt).toBeGreaterThan(0);
});

test("SqliteStore: set with metadata", async () => {
  const { store } = createStore<string>();

  await store.set("key", "value", { source: "test" });

  const entry = await store.get("key");
  expect(entry?.metadata).toEqual({ source: "test" });
});

test("SqliteStore: delete removes entry", async () => {
  const { store } = createStore<string>();

  await store.set("key", "value");

  const deleted = await store.delete("key");
  expect(deleted).toBe(true);
  expect(await store.get("key")).toBeNull();
});

test("SqliteStore: uses custom table name", async () => {
  const { store, db } = createStore<string>({
    tableName: "custom_table",
  });

  await store.set("key", "value");

  const tables = await listTables(db);
  expect(tables).toContain("custom_table");
  expect(tables).not.toContain("cria_kv_store");
});

test("SqliteStore: close closes the client", async () => {
  const { store, db } = createStore<string>();
  await store.get("key");
  store.close();
  await expect(db.execute("SELECT 1")).rejects.toThrow();
});
