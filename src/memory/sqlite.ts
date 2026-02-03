import { type Client, type Config, createClient } from "@libsql/client";
import { z } from "zod";
import type { KVMemory, MemoryEntry } from "./key-value";

/**
 * Connection options for a libSQL database.
 */
export type SqliteConnectionOptions = Omit<Config, "url">;

/**
 * libSQL Client instance used by the store.
 */
export type SqliteDatabase = Client;

const MetadataSchema = z.record(z.string(), z.unknown());

const SqliteRowSchema = z
  .object({
    key: z.string(),
    data: z.string(),
    created_at: z.coerce.number(),
    updated_at: z.coerce.number(),
    metadata: z.string().nullable(),
  })
  .transform((row) => {
    const metadata =
      row.metadata === null
        ? undefined
        : MetadataSchema.parse(JSON.parse(row.metadata));

    return {
      data: JSON.parse(row.data),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(metadata && { metadata }),
    };
  });

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
   * Options passed to the libSQL client.
   */
  options?: SqliteConnectionOptions;
  /**
   * Provide an existing database client (overrides filename/options).
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
 * Plug-and-play adapter using libSQL. Just pass a filename or
 * an existing database client.
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
      filename = ":memory:",
      options: dbOptions,
      database,
      tableName = "cria_kv_store",
      autoCreateTable = true,
    } = options;

    this.db =
      database ??
      createClient({
        url: filename === ":memory:" ? ":memory:" : `file:${filename}`,
        ...dbOptions,
      });
    this.tableName = tableName;
    this.autoCreateTable = autoCreateTable;
  }

  private async ensureTable(): Promise<void> {
    if (this.tableCreated || !this.autoCreateTable) {
      return;
    }

    await this.db.execute(`
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

  async get(key: string): Promise<MemoryEntry<T> | null> {
    await this.ensureTable();

    const result = await this.db.execute({
      sql: `SELECT key, data, created_at, updated_at, metadata FROM ${this.tableName} WHERE key = ?`,
      args: [key],
    });

    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }

    return SqliteRowSchema.parse(row) as MemoryEntry<T>;
  }

  async set(
    key: string,
    data: T,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.ensureTable();

    const now = Date.now();
    const serializedData = JSON.stringify(data);
    const serializedMetadata =
      metadata !== undefined ? JSON.stringify(metadata) : null;

    await this.db.execute({
      sql: `
        INSERT INTO ${this.tableName} (key, data, created_at, updated_at, metadata)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          data = excluded.data,
          updated_at = excluded.updated_at,
          metadata = excluded.metadata
      `,
      args: [key, serializedData, now, now, serializedMetadata],
    });
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureTable();

    const result = await this.db.execute({
      sql: `DELETE FROM ${this.tableName} WHERE key = ?`,
      args: [key],
    });

    return result.rowsAffected > 0;
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
