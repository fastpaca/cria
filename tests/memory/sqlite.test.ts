import { SqliteStore } from "@fastpaca/cria/memory/sqlite";
import { beforeEach, expect, test, vi } from "vitest";

interface SqliteRow {
  key: string;
  data: string;
  created_at: number;
  updated_at: number;
  metadata: string | null;
}

const { mockTables, getLastClient, resetState, createClient } = vi.hoisted(
  () => {
    const tables = new Map<string, Map<string, SqliteRow>>();
    let lastClient: MockClient | null = null;

    const IDENTIFIER_PATTERN = '"?[A-Za-z_][A-Za-z0-9_]*"?';
    const TABLE_PATTERN = `${IDENTIFIER_PATTERN}(?:\\.${IDENTIFIER_PATTERN})?`;
    const CREATE_TABLE_REGEX = new RegExp(
      `CREATE TABLE IF NOT EXISTS (${TABLE_PATTERN})`,
      "i"
    );
    const SELECT_REGEX = new RegExp(
      `SELECT key, data, created_at, updated_at, metadata FROM (${TABLE_PATTERN}) WHERE key = \\?`,
      "i"
    );
    const INSERT_REGEX = new RegExp(`INSERT INTO (${TABLE_PATTERN})`, "i");
    const DELETE_REGEX = new RegExp(
      `DELETE FROM (${TABLE_PATTERN}) WHERE key = \\?`,
      "i"
    );

    const normalizeTableName = (identifier: string): string =>
      identifier.replace(/"/g, "");

    class MockClient {
      closed = false;

      execute(
        stmtOrSql: string | { sql: string; args?: unknown[] }
      ): Promise<{ rows: SqliteRow[]; rowsAffected: number }> {
        const sql = typeof stmtOrSql === "string" ? stmtOrSql : stmtOrSql.sql;
        const args =
          typeof stmtOrSql === "string" ? [] : (stmtOrSql.args ?? []);

        const createMatch = sql.match(CREATE_TABLE_REGEX);
        if (createMatch) {
          const tableName = normalizeTableName(createMatch[1]);
          if (!tables.has(tableName)) {
            tables.set(tableName, new Map());
          }
          return Promise.resolve({ rows: [], rowsAffected: 0 });
        }

        const selectMatch = sql.match(SELECT_REGEX);
        if (selectMatch) {
          const tableName = normalizeTableName(selectMatch[1]);
          const key = args[0] as string;
          const row = tables.get(tableName)?.get(key);
          return Promise.resolve({ rows: row ? [row] : [], rowsAffected: 0 });
        }

        const insertMatch = sql.match(INSERT_REGEX);
        if (insertMatch) {
          const tableName = normalizeTableName(insertMatch[1]);
          const [key, data, createdAt, updatedAt, metadata] = args as [
            string,
            string,
            number,
            number,
            string | null,
          ];

          let table = tables.get(tableName);
          if (!table) {
            table = new Map();
            tables.set(tableName, table);
          }

          const existing = table.get(key);
          table.set(key, {
            key,
            data,
            created_at: existing?.created_at ?? createdAt,
            updated_at: updatedAt,
            metadata,
          });

          return Promise.resolve({ rows: [], rowsAffected: 1 });
        }

        const deleteMatch = sql.match(DELETE_REGEX);
        if (deleteMatch) {
          const tableName = normalizeTableName(deleteMatch[1]);
          const key = args[0] as string;
          const table = tables.get(tableName);
          const existed = table?.delete(key) ?? false;
          return Promise.resolve({ rows: [], rowsAffected: existed ? 1 : 0 });
        }

        return Promise.resolve({ rows: [], rowsAffected: 0 });
      }

      close(): void {
        this.closed = true;
      }
    }

    const createClient = (): MockClient => {
      lastClient = new MockClient();
      return lastClient;
    };

    return {
      mockTables: tables,
      getLastClient: (): MockClient | null => lastClient,
      resetState: (): void => {
        tables.clear();
        lastClient = null;
      },
      createClient,
    };
  }
);

vi.mock("@libsql/client", () => {
  return {
    createClient,
  };
});

beforeEach(() => {
  resetState();
});

test("SqliteStore: get returns null for missing key", async () => {
  const store = new SqliteStore<string>();
  const result = await store.get("nonexistent");
  expect(result).toBeNull();
});

test("SqliteStore: set and get", async () => {
  const store = new SqliteStore<{ value: number }>();

  await store.set("key1", { value: 42 });

  const entry = await store.get("key1");
  expect(entry).not.toBeNull();
  expect(entry?.data).toEqual({ value: 42 });
  expect(entry?.createdAt).toBeGreaterThan(0);
  expect(entry?.updatedAt).toBeGreaterThan(0);
});

test("SqliteStore: set with metadata", async () => {
  const store = new SqliteStore<string>();

  await store.set("key", "value", { source: "test", priority: 1 });

  const entry = await store.get("key");
  expect(entry?.metadata).toEqual({ source: "test", priority: 1 });
});

test("SqliteStore: update preserves createdAt, updates updatedAt", async () => {
  const store = new SqliteStore<{ count: number }>();

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
  const store = new SqliteStore<string>();

  await store.set("key", "value");
  expect(await store.get("key")).not.toBeNull();

  const deleted = await store.delete("key");
  expect(deleted).toBe(true);
  expect(await store.get("key")).toBeNull();
});

test("SqliteStore: delete returns false for missing key", async () => {
  const store = new SqliteStore<string>();
  const result = await store.delete("nonexistent");
  expect(result).toBe(false);
});

test("SqliteStore: uses custom table name", async () => {
  const store = new SqliteStore<string>({
    tableName: "my_custom_table",
  });

  await store.set("key", "value");

  expect(mockTables.has("my_custom_table")).toBe(true);
  expect(mockTables.has("cria_kv_store")).toBe(false);
});

test("SqliteStore: supports schema-qualified table names", async () => {
  const store = new SqliteStore<string>({
    tableName: "main.my_table",
  });

  await store.set("key", "value");

  expect(mockTables.has("main.my_table")).toBe(true);
  expect(mockTables.has("cria_kv_store")).toBe(false);
});

test("SqliteStore: uses default table name", async () => {
  const store = new SqliteStore<string>();

  await store.set("key", "value");

  expect(mockTables.has("cria_kv_store")).toBe(true);
});

test("SqliteStore: auto-creates table on first operation", async () => {
  const store = new SqliteStore<string>();

  expect(mockTables.has("cria_kv_store")).toBe(false);

  await store.get("nonexistent");

  expect(mockTables.has("cria_kv_store")).toBe(true);
});

test("SqliteStore: close closes the client", async () => {
  const store = new SqliteStore<string>();
  await store.get("key"); // Initialize the client
  store.close();
  expect(getLastClient()?.closed).toBe(true);
});
