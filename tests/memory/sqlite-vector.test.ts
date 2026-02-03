import { type SqliteDatabase, SqliteStore } from "@fastpaca/cria/memory/sqlite";
import { SqliteVectorStore } from "@fastpaca/cria/memory/sqlite-vector";
import { createClient } from "@libsql/client";
import { getEncoding } from "js-tiktoken";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";

const clients: SqliteDatabase[] = [];

const encoding = getEncoding("cl100k_base");
const alphaTokens = new Set([
  ...encoding.encode("alpha"),
  ...encoding.encode(" alpha"),
]);
const betaTokens = new Set([
  ...encoding.encode("beta"),
  ...encoding.encode(" beta"),
]);

const embed = (text: string): Promise<number[]> => {
  const tokens = encoding.encode(text);
  let alphaCount = 0;
  let betaCount = 0;

  for (const token of tokens) {
    if (alphaTokens.has(token)) {
      alphaCount += 1;
    }
    if (betaTokens.has(token)) {
      betaCount += 1;
    }
  }

  return Promise.resolve([alphaCount, betaCount]);
};

const schema = z.string();

const createStore = (
  options?: Partial<{ tableName: string }>
): { store: SqliteVectorStore<string>; db: SqliteDatabase } => {
  const db = createClient({ url: ":memory:" });
  clients.push(db);
  const store = new SqliteVectorStore<string>({
    database: db,
    embed,
    dimensions: 2,
    schema,
    ...options,
  });
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

test("SqliteVectorStore: set and get", async () => {
  const { store } = createStore();

  await store.set("alpha", "alpha", { source: "unit" });

  const entry = await store.get("alpha");
  expect(entry?.data).toBe("alpha");
  expect(entry?.metadata).toEqual({ source: "unit" });
  expect(entry?.createdAt).toBeGreaterThan(0);
  expect(entry?.updatedAt).toBeGreaterThan(0);
});

test("SqliteVectorStore: search returns ordered results with limit", async () => {
  const { store } = createStore();

  await store.set("alpha", "alpha");
  await store.set("alpha-beta", "alpha beta");
  await store.set("beta", "beta");

  const results = await store.search("alpha", { limit: 2 });
  expect(results.map((result) => result.key)).toEqual(["alpha", "alpha-beta"]);
  expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
});

test("SqliteVectorStore: search respects threshold", async () => {
  const { store } = createStore();

  await store.set("alpha", "alpha");
  await store.set("alpha-beta", "alpha beta");
  await store.set("beta", "beta");

  const results = await store.search("alpha", { threshold: 0.95 });
  expect(results.map((result) => result.key)).toEqual(["alpha"]);
});

test("SqliteVectorStore: delete removes entry", async () => {
  const { store } = createStore();

  await store.set("alpha", "alpha");
  expect(await store.get("alpha")).not.toBeNull();

  const deleted = await store.delete("alpha");
  expect(deleted).toBe(true);
  expect(await store.get("alpha")).toBeNull();
});

test("SqliteVectorStore: close closes the client", async () => {
  const { store, db } = createStore();
  await store.get("alpha");
  store.close();
  await expect(db.execute("SELECT 1")).rejects.toThrow();
});

test("SqliteVectorStore: uses custom table name", async () => {
  const { store, db } = createStore({ tableName: "custom_vector_table" });

  await store.set("alpha", "alpha");

  const tables = await listTables(db);
  expect(tables).toContain("custom_vector_table");
  expect(tables).not.toContain("cria_vector_store");
});

test("SqliteStore + SqliteVectorStore: shared database", async () => {
  const db = createClient({ url: ":memory:" });
  clients.push(db);

  const store = new SqliteStore<string>({
    database: db,
    tableName: "kv_table",
  });
  const vector = new SqliteVectorStore<string>({
    database: db,
    tableName: "vector_table",
    embed,
    dimensions: 2,
    schema,
  });

  await store.set("key", "value");
  expect((await store.get("key"))?.data).toBe("value");

  await vector.set("alpha", "alpha");
  expect((await vector.get("alpha"))?.data).toBe("alpha");

  const results = await vector.search("alpha", { limit: 1 });
  expect(results[0]?.key).toBe("alpha");
});
