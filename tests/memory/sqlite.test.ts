import { SqliteStore } from "@fastpaca/cria/memory/sqlite";
import { beforeEach, expect, test, vi } from "vitest";

interface SqliteRow {
  key: string;
  data: string;
  created_at: number;
  updated_at: number;
  metadata: string | null;
}

const { mockTables, getLastDatabase, resetState, MockDatabase } = vi.hoisted(
  () => {
    const tables = new Map<string, Map<string, SqliteRow>>();
    let lastDatabase: MockDatabase | null = null;

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

    class MockDatabase {
      closed = false;

      constructor() {
        lastDatabase = this;
      }

      exec(sql: string): void {
        const createMatch = sql.match(CREATE_TABLE_REGEX);
        if (!createMatch) {
          return;
        }

        const tableName = normalizeTableName(createMatch[1]);
        if (!tables.has(tableName)) {
          tables.set(tableName, new Map());
        }
      }

      prepare(sql: string): {
        get: (key: string) => SqliteRow | undefined;
        run: (
          key: string,
          data?: string,
          createdAt?: number,
          updatedAt?: number,
          metadata?: string | null
        ) => { changes: number };
      } {
        const selectMatch = sql.match(SELECT_REGEX);
        if (selectMatch) {
          const tableName = normalizeTableName(selectMatch[1]);
          return {
            get: (key: string) => tables.get(tableName)?.get(key),
            run: () => ({ changes: 0 }),
          };
        }

        const insertMatch = sql.match(INSERT_REGEX);
        if (insertMatch) {
          const tableName = normalizeTableName(insertMatch[1]);
          return {
            get: () => undefined,
            run: (
              key: string,
              data = "",
              createdAt = 0,
              updatedAt = 0,
              metadata = null
            ) => {
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

              return { changes: 1 };
            },
          };
        }

        const deleteMatch = sql.match(DELETE_REGEX);
        if (deleteMatch) {
          const tableName = normalizeTableName(deleteMatch[1]);
          return {
            get: () => undefined,
            run: (key: string) => {
              const table = tables.get(tableName);
              const existed = table?.delete(key) ?? false;
              return { changes: existed ? 1 : 0 };
            },
          };
        }

        return {
          get: () => undefined,
          run: () => ({ changes: 0 }),
        };
      }

      close(): void {
        this.closed = true;
      }
    }

    return {
      mockTables: tables,
      getLastDatabase: (): MockDatabase | null => lastDatabase,
      resetState: (): void => {
        tables.clear();
        lastDatabase = null;
      },
      MockDatabase,
    };
  }
);

vi.mock("better-sqlite3", () => {
  return {
    default: MockDatabase,
  };
});

beforeEach(() => {
  resetState();
});

test("SqliteStore: get returns null for missing key", () => {
  const store = new SqliteStore<string>();
  const result = store.get("nonexistent");
  expect(result).toBeNull();
});

test("SqliteStore: set and get", () => {
  const store = new SqliteStore<{ value: number }>();

  store.set("key1", { value: 42 });

  const entry = store.get("key1");
  expect(entry).not.toBeNull();
  expect(entry?.data).toEqual({ value: 42 });
  expect(entry?.createdAt).toBeGreaterThan(0);
  expect(entry?.updatedAt).toBeGreaterThan(0);
});

test("SqliteStore: set with metadata", () => {
  const store = new SqliteStore<string>();

  store.set("key", "value", { source: "test", priority: 1 });

  const entry = store.get("key");
  expect(entry?.metadata).toEqual({ source: "test", priority: 1 });
});

test("SqliteStore: update preserves createdAt, updates updatedAt", async () => {
  const store = new SqliteStore<{ count: number }>();

  store.set("key", { count: 1 });
  const first = store.get("key");

  await new Promise((r) => setTimeout(r, 5));

  store.set("key", { count: 2 });
  const second = store.get("key");

  expect(second?.data.count).toBe(2);
  expect(second?.createdAt).toBe(first?.createdAt);
  expect(second?.updatedAt).toBeGreaterThanOrEqual(first?.updatedAt ?? 0);
});

test("SqliteStore: delete removes entry", () => {
  const store = new SqliteStore<string>();

  store.set("key", "value");
  expect(store.get("key")).not.toBeNull();

  const deleted = store.delete("key");
  expect(deleted).toBe(true);
  expect(store.get("key")).toBeNull();
});

test("SqliteStore: delete returns false for missing key", () => {
  const store = new SqliteStore<string>();
  const result = store.delete("nonexistent");
  expect(result).toBe(false);
});

test("SqliteStore: uses custom table name", () => {
  const store = new SqliteStore<string>({
    tableName: "my_custom_table",
  });

  store.set("key", "value");

  expect(mockTables.has("my_custom_table")).toBe(true);
  expect(mockTables.has("cria_kv_store")).toBe(false);
});

test("SqliteStore: supports schema-qualified table names", () => {
  const store = new SqliteStore<string>({
    tableName: "main.my_table",
  });

  store.set("key", "value");

  expect(mockTables.has("main.my_table")).toBe(true);
  expect(mockTables.has("cria_kv_store")).toBe(false);
});

test("SqliteStore: uses default table name", () => {
  const store = new SqliteStore<string>();

  store.set("key", "value");

  expect(mockTables.has("cria_kv_store")).toBe(true);
});

test("SqliteStore: auto-creates table on first operation", () => {
  const store = new SqliteStore<string>();

  expect(mockTables.has("cria_kv_store")).toBe(false);

  store.get("nonexistent");

  expect(mockTables.has("cria_kv_store")).toBe(true);
});

test("SqliteStore: close closes the database", () => {
  const store = new SqliteStore<string>();
  store.close();
  expect(getLastDatabase()?.closed).toBe(true);
});
