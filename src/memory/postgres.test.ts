import { beforeEach, expect, test, vi } from "vitest";
import { PostgresStore } from "./postgres";

// Mock data storage
const mockTables = new Map<string, Map<string, Record<string, unknown>>>();

// Top-level regex patterns for the mock client
const CREATE_TABLE_REGEX = /CREATE TABLE IF NOT EXISTS (\w+)/i;
const SELECT_REGEX = /SELECT .+ FROM (\w+) WHERE key = \$1/i;
const INSERT_REGEX = /INSERT INTO (\w+)/i;
const DELETE_REGEX = /DELETE FROM (\w+) WHERE key = \$1/i;

// Mock pg
vi.mock("pg", () => {
  return {
    Pool: vi.fn().mockImplementation(() => ({
      query: vi.fn(
        (
          text: string,
          values?: unknown[]
        ): Promise<{ rows: unknown[]; rowCount: number | null }> => {
          const createMatch = text.match(CREATE_TABLE_REGEX);
          if (createMatch) {
            const tableName = createMatch[1];
            if (!mockTables.has(tableName)) {
              mockTables.set(tableName, new Map());
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
          }

          const selectMatch = text.match(SELECT_REGEX);
          if (selectMatch) {
            const tableName = selectMatch[1];
            const table = mockTables.get(tableName);
            const key = values?.[0] as string;
            const row = table?.get(key);

            if (row) {
              return Promise.resolve({ rows: [row], rowCount: 1 });
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
          }

          const insertMatch = text.match(INSERT_REGEX);
          if (insertMatch) {
            const tableName = insertMatch[1];
            let table = mockTables.get(tableName);
            if (!table) {
              table = new Map();
              mockTables.set(tableName, table);
            }

            const key = values?.[0] as string;
            const data = JSON.parse(values?.[1] as string);
            const timestamp = values?.[2] as Date;
            const metadata = values?.[3]
              ? JSON.parse(values?.[3] as string)
              : null;

            // Check for existing entry (upsert behavior)
            const existing = table.get(key);
            const createdAt = existing
              ? (existing.created_at as Date)
              : timestamp;

            table.set(key, {
              key,
              data,
              created_at: createdAt,
              updated_at: timestamp,
              metadata,
            });

            return Promise.resolve({ rows: [], rowCount: 1 });
          }

          const deleteMatch = text.match(DELETE_REGEX);
          if (deleteMatch) {
            const tableName = deleteMatch[1];
            const table = mockTables.get(tableName);
            const key = values?.[0] as string;
            const existed = table?.delete(key) ?? false;

            return Promise.resolve({ rows: [], rowCount: existed ? 1 : 0 });
          }

          return Promise.resolve({ rows: [], rowCount: 0 });
        }
      ),
      end: vi.fn(() => Promise.resolve()),
    })),
  };
});

beforeEach(() => {
  mockTables.clear();
});

test("PostgresStore: get returns null for missing key", async () => {
  const store = new PostgresStore<string>();
  const result = await store.get("nonexistent");
  expect(result).toBeNull();
});

test("PostgresStore: set and get", async () => {
  const store = new PostgresStore<{ value: number }>();

  await store.set("key1", { value: 42 });

  const entry = await store.get("key1");
  expect(entry).not.toBeNull();
  expect(entry?.data).toEqual({ value: 42 });
  expect(entry?.createdAt).toBeGreaterThan(0);
  expect(entry?.updatedAt).toBeGreaterThan(0);
});

test("PostgresStore: set with metadata", async () => {
  const store = new PostgresStore<string>();

  await store.set("key", "value", { source: "test", priority: 1 });

  const entry = await store.get("key");
  expect(entry?.metadata).toEqual({ source: "test", priority: 1 });
});

test("PostgresStore: update preserves createdAt, updates updatedAt", async () => {
  const store = new PostgresStore<{ count: number }>();

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

test("PostgresStore: delete removes entry", async () => {
  const store = new PostgresStore<string>();

  await store.set("key", "value");
  expect(await store.get("key")).not.toBeNull();

  const deleted = await store.delete("key");
  expect(deleted).toBe(true);
  expect(await store.get("key")).toBeNull();
});

test("PostgresStore: delete returns false for missing key", async () => {
  const store = new PostgresStore<string>();
  const result = await store.delete("nonexistent");
  expect(result).toBe(false);
});

test("PostgresStore: uses custom table name", async () => {
  const store = new PostgresStore<string>({
    tableName: "my_custom_table",
  });

  await store.set("key", "value");

  // Verify the data is stored in the custom table
  expect(mockTables.has("my_custom_table")).toBe(true);
  expect(mockTables.has("cria_kv_store")).toBe(false);
});

test("PostgresStore: uses default table name", async () => {
  const store = new PostgresStore<string>();

  await store.set("key", "value");

  expect(mockTables.has("cria_kv_store")).toBe(true);
});

test("PostgresStore: auto-creates table on first operation", async () => {
  const store = new PostgresStore<string>();

  // Table shouldn't exist yet
  expect(mockTables.has("cria_kv_store")).toBe(false);

  // First get should create table
  await store.get("nonexistent");

  expect(mockTables.has("cria_kv_store")).toBe(true);
});

test("PostgresStore: end closes the pool", async () => {
  const store = new PostgresStore<string>();
  await store.end();
  // If no error, the test passes
});
