import Database from "better-sqlite3";
import type { KVMemory, MemoryEntry } from "./key-value";

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const sanitizeIdentifier = (identifier: string): string => {
  const parts = identifier.split(".");

  if (parts.length === 0) {
    throw new Error("Table name must not be empty");
  }

  const sanitized = parts.map((part) => {
    if (!IDENTIFIER_PATTERN.test(part)) {
      throw new Error(
        "Invalid table name: use letters, numbers, and underscores (optionally schema.table)"
      );
    }

    return `"${part}"`;
  });

  return sanitized.join(".");
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJson = <T>(raw: string, context: string): T => {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`SqliteStore: invalid JSON ${context}`, { cause: error });
  }
};

const serializeJson = (value: unknown, context: string): string => {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new Error("value is not JSON-serializable");
    }
    return serialized;
  } catch (error) {
    throw new Error(`SqliteStore: failed to serialize ${context}`, {
      cause: error,
    });
  }
};

const ensureRecord = (value: unknown, key: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(
      `SqliteStore: stored metadata for key "${key}" must be an object if present`
    );
  }

  return value;
};

/**
 * Connection options for a SQLite database.
 */
export interface SqliteConnectionOptions {
  /** Open database in read-only mode */
  readonly?: boolean;
  /** Require the database file to already exist */
  fileMustExist?: boolean;
  /** Busy timeout in milliseconds */
  timeout?: number;
  /** Verbose logging callback */
  verbose?: (message?: string) => void;
  /** Custom native binding path (advanced) */
  nativeBinding?: string;
}

/**
 * Minimal SQLite database interface used by the store.
 */
export interface SqliteDatabase {
  exec(sql: string): void;
  prepare<T extends SqliteRow = SqliteRow>(sql: string): SqliteStatement<T>;
  close(): void;
}

export interface SqliteStatement<T extends SqliteRow = SqliteRow> {
  get(...params: readonly unknown[]): T | undefined;
  run(...params: readonly unknown[]): { changes: number };
}

interface SqliteRow {
  key: string;
  data: string;
  created_at: number;
  updated_at: number;
  metadata: string | null;
}

/**
 * Configuration options for the SQLite store.
 */
export interface SqliteStoreOptions {
  /**
   * Database filename. Use ":memory:" for in-memory databases.
   * @default ":memory:"
   */
  filename?: string;
  /**
   * Options passed to the SQLite driver.
   */
  options?: SqliteConnectionOptions;
  /**
   * Provide an existing database instance (overrides filename/options).
   */
  database?: SqliteDatabase;
  /**
   * Table name for storing entries.
   * The table will be created automatically if it doesn't exist.
   * @default "cria_kv_store"
   */
  tableName?: string;
  /**
   * Whether to create the table on first use if it doesn't exist.
   * @default true
   */
  autoCreateTable?: boolean;
}

/**
 * SQLite-backed implementation of KVMemory.
 *
 * Plug-and-play adapter using better-sqlite3. Just pass a filename or
 * an existing database instance.
 *
 * @template T - The type of data to store
 *
 * @example
 * ```typescript
 * import { SqliteStore } from "@fastpaca/cria/memory/sqlite";
 *
 * const store = new SqliteStore<{ content: string }>({
 *   filename: "cria.sqlite",
 * });
 *
 * await store.set("key-1", { content: "Hello" });
 * const entry = await store.get("key-1");
 * ```
 */
export class SqliteStore<T = unknown> implements KVMemory<T> {
  private readonly db: SqliteDatabase;
  private readonly tableName: string;
  private readonly autoCreateTable: boolean;
  private tableCreated = false;

  constructor(options: SqliteStoreOptions = {}) {
    const {
      filename,
      options: dbOptions,
      database,
      tableName,
      autoCreateTable,
    } = options;

    this.db = database ?? new Database(filename ?? ":memory:", dbOptions);
    this.tableName = sanitizeIdentifier(tableName ?? "cria_kv_store");
    this.autoCreateTable = autoCreateTable ?? true;
  }

  private ensureTable(): void {
    if (this.tableCreated || !this.autoCreateTable) {
      return;
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT
      )
    `);

    this.tableCreated = true;
  }

  get(key: string): MemoryEntry<T> | null {
    this.ensureTable();

    const row = this.db
      .prepare<SqliteRow>(
        `SELECT key, data, created_at, updated_at, metadata FROM ${this.tableName} WHERE key = ?`
      )
      .get(key);

    if (row === undefined) {
      return null;
    }

    const data = parseJson<T>(row.data, `for key "${key}"`);
    const parsedMetadata =
      row.metadata === null
        ? undefined
        : parseJson<unknown>(row.metadata, `metadata for key "${key}"`);
    const metadata =
      parsedMetadata === undefined
        ? undefined
        : ensureRecord(parsedMetadata, key);

    return {
      data,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(metadata && { metadata }),
    };
  }

  set(key: string, data: T, metadata?: Record<string, unknown>): void {
    this.ensureTable();

    const now = Date.now();
    const serializedData = serializeJson(data, `data for key "${key}"`);
    const serializedMetadata =
      metadata !== undefined
        ? serializeJson(metadata, `metadata for key "${key}"`)
        : null;

    this.db
      .prepare(
        `
        INSERT INTO ${this.tableName} (key, data, created_at, updated_at, metadata)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          data = excluded.data,
          updated_at = excluded.updated_at,
          metadata = excluded.metadata
        `
      )
      .run(key, serializedData, now, now, serializedMetadata);
  }

  delete(key: string): boolean {
    this.ensureTable();

    const result = this.db
      .prepare(`DELETE FROM ${this.tableName} WHERE key = ?`)
      .run(key);

    return result.changes > 0;
  }

  /**
   * Close the database connection.
   * Call this when you're done using the store to clean up resources.
   */
  close(): void {
    this.db.close();
  }
}

// Re-export types for convenience
export type { KVMemory, MemoryEntry } from "./key-value";
