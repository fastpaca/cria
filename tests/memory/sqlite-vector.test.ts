import { SqliteVectorStore } from "@fastpaca/cria/memory/sqlite-vector";
import { beforeEach, expect, test, vi } from "vitest";

interface StoredRow {
  key: string;
  data: string;
  embedding: number[];
  created_at: number;
  updated_at: number;
  metadata: string | null;
}

interface SearchRow {
  key: string;
  data: string;
  created_at: number;
  updated_at: number;
  metadata: string | null;
  distance: number;
}

const { mockTables, getLastClient, resetState, createClient } = vi.hoisted(
  () => {
    const tables = new Map<string, Map<string, StoredRow>>();
    let lastClient: MockClient | null = null;

    const IDENTIFIER_PATTERN = '"?[A-Za-z_][A-Za-z0-9_]*"?';
    const TABLE_PATTERN = `${IDENTIFIER_PATTERN}(?:\\.${IDENTIFIER_PATTERN})?`;
    const CREATE_TABLE_REGEX = new RegExp(
      `CREATE TABLE IF NOT EXISTS (${TABLE_PATTERN})`,
      "i"
    );
    const CREATE_INDEX_REGEX = new RegExp(
      `CREATE INDEX IF NOT EXISTS (${IDENTIFIER_PATTERN})\\s+ON\\s+(${TABLE_PATTERN})`,
      "i"
    );
    const SELECT_BY_KEY_REGEX = new RegExp(
      `SELECT key, data, created_at, updated_at, metadata FROM (${TABLE_PATTERN}) WHERE key = \\?`,
      "i"
    );
    const INSERT_REGEX = new RegExp(`INSERT INTO (${TABLE_PATTERN})`, "i");
    const DELETE_REGEX = new RegExp(
      `DELETE FROM (${TABLE_PATTERN}) WHERE key = \\?`,
      "i"
    );
    const SEARCH_REGEX = new RegExp(
      `FROM\\s+vector_top_k\\(\\s*\\?,\\s*\\w+\\(\\?\\),\\s*CAST\\(\\? AS INTEGER\\)\\s*\\)\\s+AS\\s+i\\s+JOIN\\s+(${TABLE_PATTERN})\\s+AS\\s+t`,
      "i"
    );
    const normalizeTableName = (identifier: string): string =>
      identifier.replace(/"/g, "");

    const cosineDistance = (left: number[], right: number[]): number => {
      if (left.length !== right.length) {
        throw new Error("Embedding length mismatch in cosine distance");
      }

      let dot = 0;
      let leftNorm = 0;
      let rightNorm = 0;

      for (let i = 0; i < left.length; i++) {
        const leftValue = left[i] ?? 0;
        const rightValue = right[i] ?? 0;
        dot += leftValue * rightValue;
        leftNorm += leftValue * leftValue;
        rightNorm += rightValue * rightValue;
      }

      const denom = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
      if (denom === 0) {
        return 1;
      }

      const similarity = dot / denom;
      return 1 - similarity;
    };

    class MockClient {
      closed = false;

      execute(
        stmtOrSql: string | { sql: string; args?: unknown[] }
      ): Promise<{ rows: (StoredRow | SearchRow)[]; rowsAffected: number }> {
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

        const createIndexMatch = sql.match(CREATE_INDEX_REGEX);
        if (createIndexMatch) {
          const tableName = normalizeTableName(createIndexMatch[2]);
          if (!tables.has(tableName)) {
            tables.set(tableName, new Map());
          }
          return Promise.resolve({ rows: [], rowsAffected: 0 });
        }

        const selectMatch = sql.match(SELECT_BY_KEY_REGEX);
        if (selectMatch) {
          const tableName = normalizeTableName(selectMatch[1]);
          const key = args[0] as string;
          const row = tables.get(tableName)?.get(key);
          if (!row) {
            return Promise.resolve({ rows: [], rowsAffected: 0 });
          }
          return Promise.resolve({
            rows: [
              {
                key: row.key,
                data: row.data,
                created_at: row.created_at,
                updated_at: row.updated_at,
                metadata: row.metadata,
              },
            ],
            rowsAffected: 0,
          });
        }

        const insertMatch = sql.match(INSERT_REGEX);
        if (insertMatch) {
          const tableName = normalizeTableName(insertMatch[1]);
          const [key, data, embedding, createdAt, updatedAt, metadata] =
            args as [string, string, string, number, number, string | null];

          let table = tables.get(tableName);
          if (!table) {
            table = new Map();
            tables.set(tableName, table);
          }

          const existing = table.get(key);
          table.set(key, {
            key,
            data,
            embedding: JSON.parse(embedding) as number[],
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

        const searchMatch = sql.match(SEARCH_REGEX);
        if (searchMatch) {
          const tableName = normalizeTableName(searchMatch[1]);
          const queryVector = JSON.parse(args[1] as string) as number[];
          const limit = Number(args[2] ?? 10);
          const table = tables.get(tableName);

          const scored = Array.from(table?.values() ?? []).map((row) => ({
            row,
            distance: cosineDistance(queryVector, row.embedding),
          }));

          scored.sort((a, b) => a.distance - b.distance);

          const rows = scored.slice(0, limit).map(({ row, distance }) => ({
            key: row.key,
            data: row.data,
            created_at: row.created_at,
            updated_at: row.updated_at,
            metadata: row.metadata,
            distance,
          }));

          return Promise.resolve({ rows, rowsAffected: 0 });
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

const embeddings: Record<string, number[]> = {
  alpha: [1, 0],
  beta: [0, 1],
  "alpha beta": [0.8, 0.6],
};

const embed = (text: string): Promise<number[]> => {
  const vector = embeddings[text];
  if (!vector) {
    throw new Error(`Missing embedding for ${text}`);
  }
  return Promise.resolve(vector);
};

test("SqliteVectorStore: set and get", async () => {
  const store = new SqliteVectorStore<string>({ embed, dimensions: 2 });

  await store.set("alpha", "alpha", { source: "unit" });

  const entry = await store.get("alpha");
  expect(entry?.data).toBe("alpha");
  expect(entry?.metadata).toEqual({ source: "unit" });
  expect(entry?.createdAt).toBeGreaterThan(0);
  expect(entry?.updatedAt).toBeGreaterThan(0);
});

test("SqliteVectorStore: search returns ordered results with limit", async () => {
  const store = new SqliteVectorStore<string>({ embed, dimensions: 2 });

  await store.set("alpha", "alpha");
  await store.set("alpha-beta", "alpha beta");
  await store.set("beta", "beta");

  const results = await store.search("alpha", { limit: 2 });
  expect(results.map((result) => result.key)).toEqual(["alpha", "alpha-beta"]);
  expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
});

test("SqliteVectorStore: search respects threshold", async () => {
  const store = new SqliteVectorStore<string>({ embed, dimensions: 2 });

  await store.set("alpha", "alpha");
  await store.set("alpha-beta", "alpha beta");
  await store.set("beta", "beta");

  const results = await store.search("alpha", { threshold: 0.95 });
  expect(results.map((result) => result.key)).toEqual(["alpha"]);
});

test("SqliteVectorStore: delete removes entry", async () => {
  const store = new SqliteVectorStore<string>({ embed, dimensions: 2 });

  await store.set("alpha", "alpha");
  expect(await store.get("alpha")).not.toBeNull();

  const deleted = await store.delete("alpha");
  expect(deleted).toBe(true);
  expect(await store.get("alpha")).toBeNull();
});

test("SqliteVectorStore: close closes the client", async () => {
  const store = new SqliteVectorStore<string>({ embed, dimensions: 2 });
  await store.get("alpha");
  store.close();
  expect(getLastClient()?.closed).toBe(true);
});

test("SqliteVectorStore: uses custom table name", async () => {
  const store = new SqliteVectorStore<string>({
    embed,
    dimensions: 2,
    tableName: "custom_vector_table",
  });

  await store.set("alpha", "alpha");

  expect(mockTables.has("custom_vector_table")).toBe(true);
  expect(mockTables.has("cria_vector_store")).toBe(false);
});
