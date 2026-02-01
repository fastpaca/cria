import { SqliteVecStore } from "@fastpaca/cria/memory/sqlite-vec";
import { beforeEach, expect, test, vi } from "vitest";

const DIMENSION_REGEX = /float\[(\d+)\]/i;
const COSINE_REGEX = /distance_metric=cosine/i;
const VECTOR_PREFIX_REGEX = /^\[/;
const VECTOR_SUFFIX_REGEX = /\]$/;

interface BaseRow {
  key: string;
  data: string;
  created_at: number;
  updated_at: number;
  metadata: string | null;
  rowid: number;
}

interface VecRow {
  embedding: number[];
}

type DistanceMetric = "l2" | "cosine";

interface BaseTableState {
  rows: Map<string, BaseRow>;
  nextRowId: number;
}

interface VecTableState {
  rows: Map<number, VecRow>;
  distanceMetric: DistanceMetric;
  dimensions: number;
}

const { resetState, MockDatabase } = vi.hoisted(() => {
  const baseTables = new Map<string, BaseTableState>();
  const vecTables = new Map<string, VecTableState>();

  const IDENTIFIER_PATTERN = '"?[A-Za-z_][A-Za-z0-9_]*"?';
  const TABLE_PATTERN = `${IDENTIFIER_PATTERN}(?:\\.${IDENTIFIER_PATTERN})?`;
  const CREATE_TABLE_REGEX = new RegExp(
    `CREATE TABLE IF NOT EXISTS (${TABLE_PATTERN})`,
    "i"
  );
  const CREATE_VEC_REGEX = new RegExp(
    `CREATE VIRTUAL TABLE IF NOT EXISTS (${TABLE_PATTERN}) USING vec0\\(([^)]*)\\)`,
    "i"
  );
  const SELECT_ENTRY_REGEX = new RegExp(
    `SELECT key, data, created_at, updated_at, metadata, 0 as distance FROM (${TABLE_PATTERN}) WHERE key = \\?`,
    "i"
  );
  const SELECT_ROWID_REGEX = new RegExp(
    `SELECT rowid(?:, created_at)? FROM (${TABLE_PATTERN}) WHERE key = \\?`,
    "i"
  );
  const INSERT_ENTRY_REGEX = new RegExp(
    `INSERT INTO (${TABLE_PATTERN}) \\(key, data, created_at, updated_at, metadata\\) VALUES \\(\\?, \\?, \\?, \\?, \\?\\)`,
    "i"
  );
  const UPDATE_ENTRY_REGEX = new RegExp(
    `UPDATE (${TABLE_PATTERN}) SET data = \\?, updated_at = \\?, metadata = \\? WHERE key = \\?`,
    "i"
  );
  const INSERT_VEC_REGEX = new RegExp(
    `INSERT OR REPLACE INTO (${TABLE_PATTERN}) \\(rowid, embedding\\) VALUES \\(\\?, \\?\\)`,
    "i"
  );
  const DELETE_ENTRY_REGEX = new RegExp(
    `DELETE FROM (${TABLE_PATTERN}) WHERE key = \\?`,
    "i"
  );
  const DELETE_VEC_REGEX = new RegExp(
    `DELETE FROM (${TABLE_PATTERN}) WHERE rowid = \\?`,
    "i"
  );
  const SEARCH_REGEX = new RegExp(
    `FROM (${TABLE_PATTERN}) AS vec\\s+JOIN (${TABLE_PATTERN}) AS base`,
    "i"
  );

  const normalizeTableName = (identifier: string): string =>
    identifier.replace(/"/g, "");

  const parseVector = (raw: string): number[] => {
    const trimmed = raw.trim();
    const content = trimmed
      .replace(VECTOR_PREFIX_REGEX, "")
      .replace(VECTOR_SUFFIX_REGEX, "");
    if (!content) {
      return [];
    }
    return content.split(",").map((value) => Number(value));
  };

  const l2Distance = (a: number[], b: number[]): number => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const delta = (a[i] ?? 0) - (b[i] ?? 0);
      sum += delta * delta;
    }
    return Math.sqrt(sum);
  };

  const cosineDistance = (a: number[], b: number[]): number => {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const av = a[i] ?? 0;
      const bv = b[i] ?? 0;
      dot += av * bv;
      normA += av * av;
      normB += bv * bv;
    }

    if (normA === 0 || normB === 0) {
      return 1;
    }

    const cosine = dot / (Math.sqrt(normA) * Math.sqrt(normB));
    return 1 - cosine;
  };

  class MockDatabase {
    exec(sql: string): void {
      const createTableMatch = sql.match(CREATE_TABLE_REGEX);
      if (createTableMatch) {
        const tableName = normalizeTableName(createTableMatch[1]);
        if (!baseTables.has(tableName)) {
          baseTables.set(tableName, { rows: new Map(), nextRowId: 1 });
        }
        return;
      }

      const createVecMatch = sql.match(CREATE_VEC_REGEX);
      if (createVecMatch) {
        const tableName = normalizeTableName(createVecMatch[1]);
        const columnDef = createVecMatch[2] ?? "";
        const dimensions = Number(columnDef.match(DIMENSION_REGEX)?.[1] ?? 0);
        const distanceMetric: DistanceMetric = COSINE_REGEX.test(columnDef)
          ? "cosine"
          : "l2";

        if (!vecTables.has(tableName)) {
          vecTables.set(tableName, {
            rows: new Map(),
            distanceMetric,
            dimensions,
          });
        }
      }
    }

    prepare(sql: string): {
      get: (
        ...params: readonly unknown[]
      ) => BaseRow | { rowid: number; created_at?: number } | undefined;
      run: (...params: readonly unknown[]) => { changes: number };
      all: (
        ...params: readonly unknown[]
      ) => Array<BaseRow & { distance: number }>;
    } {
      const selectEntryMatch = sql.match(SELECT_ENTRY_REGEX);
      if (selectEntryMatch) {
        const tableName = normalizeTableName(selectEntryMatch[1]);
        return {
          get: (key: string) => baseTables.get(tableName)?.rows.get(key),
          run: () => ({ changes: 0 }),
          all: () => [],
        };
      }

      const selectRowIdMatch = sql.match(SELECT_ROWID_REGEX);
      if (selectRowIdMatch) {
        const tableName = normalizeTableName(selectRowIdMatch[1]);
        return {
          get: (key: string) => {
            const row = baseTables.get(tableName)?.rows.get(key);
            if (!row) {
              return undefined;
            }
            return {
              rowid: row.rowid,
              created_at: row.created_at,
            };
          },
          run: () => ({ changes: 0 }),
          all: () => [],
        };
      }

      const insertEntryMatch = sql.match(INSERT_ENTRY_REGEX);
      if (insertEntryMatch) {
        const tableName = normalizeTableName(insertEntryMatch[1]);
        return {
          get: () => undefined,
          run: (
            key: string,
            data: string,
            createdAt: number,
            updatedAt: number,
            metadata: string | null
          ) => {
            const table = baseTables.get(tableName);
            if (!table) {
              return { changes: 0 };
            }
            const rowid = table.nextRowId++;
            table.rows.set(key, {
              key,
              data,
              created_at: createdAt,
              updated_at: updatedAt,
              metadata,
              rowid,
            });
            return { changes: 1 };
          },
          all: () => [],
        };
      }

      const updateEntryMatch = sql.match(UPDATE_ENTRY_REGEX);
      if (updateEntryMatch) {
        const tableName = normalizeTableName(updateEntryMatch[1]);
        return {
          get: () => undefined,
          run: (
            data: string,
            updatedAt: number,
            metadata: string | null,
            key: string
          ) => {
            const table = baseTables.get(tableName);
            const row = table?.rows.get(key);
            if (!row) {
              return { changes: 0 };
            }
            table?.rows.set(key, {
              ...row,
              data,
              updated_at: updatedAt,
              metadata,
            });
            return { changes: 1 };
          },
          all: () => [],
        };
      }

      const insertVecMatch = sql.match(INSERT_VEC_REGEX);
      if (insertVecMatch) {
        const tableName = normalizeTableName(insertVecMatch[1]);
        return {
          get: () => undefined,
          run: (rowid: number | bigint, embedding: string) => {
            const table = vecTables.get(tableName);
            if (!table) {
              return { changes: 0 };
            }
            const key = typeof rowid === "bigint" ? Number(rowid) : rowid;
            table.rows.set(key, { embedding: parseVector(embedding) });
            return { changes: 1 };
          },
          all: () => [],
        };
      }

      const deleteEntryMatch = sql.match(DELETE_ENTRY_REGEX);
      if (deleteEntryMatch) {
        const tableName = normalizeTableName(deleteEntryMatch[1]);
        return {
          get: () => undefined,
          run: (key: string) => {
            const table = baseTables.get(tableName);
            const existed = table?.rows.delete(key) ?? false;
            return { changes: existed ? 1 : 0 };
          },
          all: () => [],
        };
      }

      const deleteVecMatch = sql.match(DELETE_VEC_REGEX);
      if (deleteVecMatch) {
        const tableName = normalizeTableName(deleteVecMatch[1]);
        return {
          get: () => undefined,
          run: (rowid: number | bigint) => {
            const table = vecTables.get(tableName);
            const key = typeof rowid === "bigint" ? Number(rowid) : rowid;
            const existed = table?.rows.delete(key) ?? false;
            return { changes: existed ? 1 : 0 };
          },
          all: () => [],
        };
      }

      const searchMatch = sql.match(SEARCH_REGEX);
      if (searchMatch) {
        const vecTableName = normalizeTableName(searchMatch[1]);
        const baseTableName = normalizeTableName(searchMatch[2]);
        return {
          get: () => undefined,
          run: () => ({ changes: 0 }),
          all: (query: string, k: number) => {
            const vecTable = vecTables.get(vecTableName);
            const baseTable = baseTables.get(baseTableName);
            if (!(vecTable && baseTable)) {
              return [];
            }

            const queryVector = parseVector(query);
            const results: Array<BaseRow & { distance: number }> = [];

            for (const [rowid, vecRow] of vecTable.rows.entries()) {
              const baseRow = Array.from(baseTable.rows.values()).find(
                (row) => row.rowid === rowid
              );
              if (!baseRow) {
                continue;
              }

              const distance =
                vecTable.distanceMetric === "cosine"
                  ? cosineDistance(queryVector, vecRow.embedding)
                  : l2Distance(queryVector, vecRow.embedding);

              results.push({
                ...baseRow,
                distance,
              });
            }

            results.sort((a, b) => a.distance - b.distance);

            return results.slice(0, k);
          },
        };
      }

      return {
        get: () => undefined,
        run: () => ({ changes: 0 }),
        all: () => [],
      };
    }

    close(): void {
      // No-op for mocked database.
    }
  }

  return {
    baseTables,
    vecTables,
    resetState: () => {
      baseTables.clear();
      vecTables.clear();
    },
    MockDatabase,
  };
});

vi.mock("better-sqlite3", () => {
  return {
    default: MockDatabase,
  };
});

beforeEach(() => {
  resetState();
});

test("SqliteVecStore: get returns null for missing key", () => {
  const store = new SqliteVecStore<string>({
    embed: () => Promise.resolve([0, 0]),
    dimensions: 2,
  });

  expect(store.get("missing")).toBeNull();
});

test("SqliteVecStore: set and get", async () => {
  const store = new SqliteVecStore<{ value: number }>({
    embed: () => Promise.resolve([0, 1]),
    dimensions: 2,
  });

  await store.set("key1", { value: 42 });

  const entry = store.get("key1");
  expect(entry).not.toBeNull();
  expect(entry?.data).toEqual({ value: 42 });
  expect(entry?.createdAt).toBeGreaterThan(0);
  expect(entry?.updatedAt).toBeGreaterThan(0);
});

test("SqliteVecStore: update preserves createdAt", async () => {
  const store = new SqliteVecStore<{ count: number }>({
    embed: () => Promise.resolve([0, 1]),
    dimensions: 2,
  });

  await store.set("key", { count: 1 });
  const first = store.get("key");

  await new Promise((r) => setTimeout(r, 5));

  await store.set("key", { count: 2 });
  const second = store.get("key");

  expect(second?.data.count).toBe(2);
  expect(second?.createdAt).toBe(first?.createdAt);
  expect(second?.updatedAt).toBeGreaterThanOrEqual(first?.updatedAt ?? 0);
});

test("SqliteVecStore: delete removes entry", async () => {
  const store = new SqliteVecStore<string>({
    embed: () => Promise.resolve([0, 0]),
    dimensions: 2,
  });

  await store.set("key", "value");
  expect(store.get("key")).not.toBeNull();

  const deleted = store.delete("key");
  expect(deleted).toBe(true);
  expect(store.get("key")).toBeNull();
});

test("SqliteVecStore: search orders by l2 score", async () => {
  const embed = (text: string): Promise<number[]> => {
    if (text === "doc-1") {
      return Promise.resolve([1, 0]);
    }
    if (text === "doc-2") {
      return Promise.resolve([2, 0]);
    }
    if (text === "query") {
      return Promise.resolve([1, 0]);
    }
    return Promise.resolve([0, 0]);
  };

  const store = new SqliteVecStore<string>({
    embed,
    dimensions: 2,
  });

  await store.set("doc-1", "doc-1");
  await store.set("doc-2", "doc-2");

  const results = await store.search("query", { limit: 2 });

  expect(results).toHaveLength(2);
  expect(results[0]?.key).toBe("doc-1");
  expect(results[0]?.score).toBeCloseTo(1);
  expect(results[1]?.key).toBe("doc-2");
  expect(results[1]?.score).toBeCloseTo(0.5);
});

test("SqliteVecStore: search supports cosine distance", async () => {
  const embed = (text: string): Promise<number[]> => {
    if (text === "doc-1") {
      return Promise.resolve([1, 0]);
    }
    if (text === "doc-2") {
      return Promise.resolve([0, 1]);
    }
    if (text === "query") {
      return Promise.resolve([1, 0]);
    }
    return Promise.resolve([0, 0]);
  };

  const store = new SqliteVecStore<string>({
    embed,
    dimensions: 2,
    distanceMetric: "cosine",
  });

  await store.set("doc-1", "doc-1");
  await store.set("doc-2", "doc-2");

  const results = await store.search("query", { limit: 2 });

  expect(results).toHaveLength(2);
  expect(results[0]?.key).toBe("doc-1");
  expect(results[0]?.score).toBeCloseTo(1);
  expect(results[1]?.key).toBe("doc-2");
  expect(results[1]?.score).toBeCloseTo(0);
});

test("SqliteVecStore: search respects threshold", async () => {
  const embed = (text: string): Promise<number[]> => {
    if (text === "doc-1") {
      return Promise.resolve([1, 0]);
    }
    if (text === "doc-2") {
      return Promise.resolve([2, 0]);
    }
    if (text === "query") {
      return Promise.resolve([1, 0]);
    }
    return Promise.resolve([0, 0]);
  };

  const store = new SqliteVecStore<string>({
    embed,
    dimensions: 2,
  });

  await store.set("doc-1", "doc-1");
  await store.set("doc-2", "doc-2");

  const results = await store.search("query", { limit: 2, threshold: 0.75 });

  expect(results).toHaveLength(1);
  expect(results[0]?.key).toBe("doc-1");
});
