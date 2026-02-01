import type { PoolConfig } from "pg";
import { Pool } from "pg";
import type { KVMemory, MemoryEntry } from "./key-value";

/**
 * Configuration options for the Postgres store.
 */
export interface PostgresStoreOptions extends PoolConfig {
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
 * Database row structure for the kv store table.
 */
interface KVRow {
  key: string;
  data: unknown;
  created_at: Date;
  updated_at: Date;
  metadata: Record<string, unknown> | null;
}

/**
 * Postgres-backed implementation of KVMemory.
 *
 * Plug-and-play adapter using node-postgres (pg). Just pass your connection options.
 *
 * The store will automatically create the required table if it doesn't exist.
 *
 * @template T - The type of data to store
 *
 * @example
 * ```typescript
 * import { PostgresStore } from "@fastpaca/cria/memory/postgres";
 *
 * // Connect using environment variables (PG* env vars)
 * const store = new PostgresStore<{ content: string }>();
 *
 * // Connect with options
 * const store = new PostgresStore<{ content: string }>({
 *   connectionString: "postgres://user:pass@localhost/mydb",
 * });
 *
 * await store.set("key-1", { content: "Hello" });
 * const entry = await store.get("key-1");
 * ```
 *
 * @example
 * ```typescript
 * // With custom table name
 * const store = new PostgresStore<string>({
 *   host: "localhost",
 *   database: "myapp",
 *   tableName: "my_app_memory",
 * });
 * ```
 */
export class PostgresStore<T = unknown> implements KVMemory<T> {
  private readonly pool: Pool;
  private readonly tableName: string;
  private readonly autoCreateTable: boolean;
  private tableCreated = false;

  constructor(options: PostgresStoreOptions = {}) {
    const { tableName, autoCreateTable, ...poolConfig } = options;

    this.tableName = tableName ?? "cria_kv_store";
    this.pool = new Pool(poolConfig);
    this.autoCreateTable = autoCreateTable ?? true;
  }

  private async ensureTable(): Promise<void> {
    if (this.tableCreated || !this.autoCreateTable) {
      return;
    }

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        metadata JSONB
      )
    `);

    this.tableCreated = true;
  }

  async get(key: string): Promise<MemoryEntry<T> | null> {
    await this.ensureTable();

    const result = await this.pool.query<KVRow>(
      `SELECT key, data, created_at, updated_at, metadata FROM ${this.tableName} WHERE key = $1`,
      [key]
    );

    const row = result.rows[0];

    if (row === undefined) {
      return null;
    }

    return {
      data: row.data as T,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      ...(row.metadata && { metadata: row.metadata }),
    };
  }

  async set(
    key: string,
    data: T,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.ensureTable();

    const now = new Date();

    // Use UPSERT to handle both insert and update cases
    // ON CONFLICT preserves created_at and updates updated_at
    await this.pool.query(
      `
      INSERT INTO ${this.tableName} (key, data, created_at, updated_at, metadata)
      VALUES ($1, $2, $3, $3, $4)
      ON CONFLICT (key) DO UPDATE SET
        data = EXCLUDED.data,
        updated_at = EXCLUDED.updated_at,
        metadata = EXCLUDED.metadata
      `,
      [
        key,
        JSON.stringify(data),
        now,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureTable();

    const result = await this.pool.query(
      `DELETE FROM ${this.tableName} WHERE key = $1`,
      [key]
    );

    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Close the connection pool.
   * Call this when you're done using the store to clean up connections.
   */
  async end(): Promise<void> {
    await this.pool.end();
  }
}

// Re-export types for convenience
export type { KVMemory, MemoryEntry } from "./key-value";
