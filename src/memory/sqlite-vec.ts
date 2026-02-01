import Database from "better-sqlite3";
import type { MemoryEntry } from "./key-value";
import type { SqliteConnectionOptions, SqliteDatabase } from "./sqlite";
import type {
  VectorMemory,
  VectorSearchOptions,
  VectorSearchResult,
} from "./vector";

/**
 * Function to generate embeddings for text.
 */
export type EmbeddingFunction = (text: string) => Promise<number[]>;

export type SqliteVecDistanceMetric = "l2" | "cosine";

interface SqliteVecRow {
  key: string;
  data: string;
  created_at: number;
  updated_at: number;
  metadata: string | null;
  distance: number;
}

interface SqliteVecKeyRow {
  rowid: number;
  created_at?: number;
}

interface SqliteVecStatement<T> {
  get(...params: readonly unknown[]): T | undefined;
  run(...params: readonly unknown[]): { changes: number };
  all(...params: readonly unknown[]): T[];
}

interface SqliteVecDatabase extends SqliteDatabase {
  loadExtension?: (path: string) => void;
  prepare<T>(sql: string): SqliteVecStatement<T>;
}

/**
 * Configuration options for the SQLite vec0 store.
 */
export interface SqliteVecStoreOptions {
  /** Function to generate embeddings from text */
  embed: EmbeddingFunction;
  /** Vector dimensions */
  dimensions: number;
  /** Distance metric used for similarity scoring */
  distanceMetric?: SqliteVecDistanceMetric;
  /** Database filename. Use ":memory:" for in-memory databases. */
  filename?: string;
  /** Options passed to the SQLite driver. */
  options?: SqliteConnectionOptions;
  /** Provide an existing database instance (overrides filename/options). */
  database?: SqliteDatabase;
  /** Base table name for stored entries. */
  tableName?: string;
  /** vec0 table name for embeddings. */
  vectorTableName?: string;
  /** Whether to create tables on first use. */
  autoCreateTables?: boolean;
  /** Optional path to a sqlite-vec loadable extension. */
  loadExtension?: string;
}

/**
 * SQLite vec0-backed implementation of VectorMemory.
 *
 * Uses sqlite-vec to store embeddings in a virtual table and a regular table for
 * key/value data, then joins them during search.
 */
export class SqliteVecStore<T = unknown> implements VectorMemory<T> {
  private readonly db: SqliteVecDatabase;
  private readonly tableName: string;
  private readonly vectorTableName: string;
  private readonly embedFn: EmbeddingFunction;
  private readonly dimensions: number;
  private readonly distanceMetric: SqliteVecDistanceMetric;
  private readonly autoCreateTables: boolean;
  private readonly loadExtensionPath: string | undefined;
  private tablesReady = false;
  private extensionChecked = false;

  constructor(options: SqliteVecStoreOptions) {
    const {
      embed,
      dimensions,
      distanceMetric,
      filename,
      options: dbOptions,
      database,
      tableName,
      vectorTableName,
      autoCreateTables,
      loadExtension,
    } = options;

    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new Error("SqliteVecStore: dimensions must be a positive integer");
    }

    const baseName = tableName ?? "cria_vec_store";
    const vecName = vectorTableName ?? `${baseName}_vec`;

    this.db = (database ??
      new Database(filename ?? ":memory:", dbOptions)) as SqliteVecDatabase;
    this.tableName = baseName;
    this.vectorTableName = vecName;
    this.embedFn = embed;
    this.dimensions = dimensions;
    this.distanceMetric = distanceMetric ?? "l2";
    this.autoCreateTables = autoCreateTables ?? true;
    this.loadExtensionPath = loadExtension;
  }

  private ensureExtension(): void {
    if (this.extensionChecked) {
      return;
    }

    if (this.loadExtensionPath) {
      if (typeof this.db.loadExtension !== "function") {
        throw new Error(
          "SqliteVecStore: loadExtension is not available on the provided database"
        );
      }

      this.db.loadExtension(this.loadExtensionPath);
    }

    try {
      this.db.prepare("select vec_version() as version").get();
    } catch (error) {
      throw new Error(
        "SqliteVecStore: sqlite-vec extension is not loaded. Load the vec0 extension before using this store.",
        { cause: error }
      );
    }

    this.extensionChecked = true;
  }

  private ensureTables(): void {
    if (this.tablesReady || !this.autoCreateTables) {
      return;
    }

    this.ensureExtension();

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT
      )
    `);

    const metricClause =
      this.distanceMetric === "cosine" ? " distance_metric=cosine" : "";

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${this.vectorTableName} USING vec0(
        embedding float[${this.dimensions}]${metricClause}
      )
    `);

    this.tablesReady = true;
  }

  private async embed(text: string, context: string): Promise<number[]> {
    try {
      return await this.embedFn(text);
    } catch (error) {
      throw new Error(`SqliteVecStore: embedding failed during ${context}`, {
        cause: error,
      });
    }
  }

  private serializeVector(vector: readonly number[], context: string): string {
    if (vector.length === 0) {
      throw new Error(
        `SqliteVecStore: embedding returned an empty vector during ${context}`
      );
    }

    if (vector.length !== this.dimensions) {
      throw new Error(
        `SqliteVecStore: embedding length ${vector.length} does not match configured dimensions ${this.dimensions} during ${context}`
      );
    }

    const serialized = vector
      .map((value, index) => {
        if (!Number.isFinite(value)) {
          throw new Error(
            `SqliteVecStore: embedding value at index ${index} is not a finite number during ${context}`
          );
        }

        return String(value);
      })
      .join(",");

    return `[${serialized}]`;
  }

  private scoreFromDistance(distance: number): number {
    if (this.distanceMetric === "cosine") {
      const score = 1 - distance;
      return Math.min(1, Math.max(0, score));
    }

    return 1 / (1 + distance);
  }

  get(key: string): MemoryEntry<T> | null {
    this.ensureTables();

    const row = this.db
      .prepare<SqliteVecRow>(
        `SELECT key, data, created_at, updated_at, metadata, 0 as distance FROM ${this.tableName} WHERE key = ?`
      )
      .get(key);

    if (row === undefined) {
      return null;
    }

    const data = JSON.parse(row.data) as T;
    const metadata =
      row.metadata === null
        ? undefined
        : (JSON.parse(row.metadata) as Record<string, unknown>);

    return {
      data,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(metadata && { metadata }),
    };
  }

  async set(
    key: string,
    data: T,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    this.ensureExtension();
    this.ensureTables();

    const now = Date.now();
    const serializedData = JSON.stringify(data);
    const serializedMetadata =
      metadata !== undefined ? JSON.stringify(metadata) : null;

    const existing = this.db
      .prepare<SqliteVecKeyRow>(
        `SELECT rowid, created_at FROM ${this.tableName} WHERE key = ?`
      )
      .get(key);

    let rowid: number;

    if (existing) {
      rowid = existing.rowid;
      this.db
        .prepare(
          `UPDATE ${this.tableName} SET data = ?, updated_at = ?, metadata = ? WHERE key = ?`
        )
        .run(serializedData, now, serializedMetadata, key);
    } else {
      this.db
        .prepare(
          `INSERT INTO ${this.tableName} (key, data, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?)`
        )
        .run(key, serializedData, now, now, serializedMetadata);

      const inserted = this.db
        .prepare<SqliteVecKeyRow>(
          `SELECT rowid FROM ${this.tableName} WHERE key = ?`
        )
        .get(key);

      if (!inserted) {
        throw new Error(
          `SqliteVecStore: failed to resolve rowid after insert for key "${key}"`
        );
      }

      rowid = inserted.rowid;
    }

    const textToEmbed = typeof data === "string" ? data : serializedData;
    const vector = await this.embed(textToEmbed, `set("${key}")`);
    const vectorLiteral = this.serializeVector(vector, `set("${key}")`);

    this.db
      .prepare(
        `INSERT OR REPLACE INTO ${this.vectorTableName} (rowid, embedding) VALUES (?, ?)`
      )
      .run(rowid, vectorLiteral);
  }

  delete(key: string): boolean {
    this.ensureTables();

    const row = this.db
      .prepare<SqliteVecKeyRow>(
        `SELECT rowid FROM ${this.tableName} WHERE key = ?`
      )
      .get(key);

    if (!row) {
      return false;
    }

    this.db.prepare(`DELETE FROM ${this.tableName} WHERE key = ?`).run(key);

    this.db
      .prepare(`DELETE FROM ${this.vectorTableName} WHERE rowid = ?`)
      .run(row.rowid);

    return true;
  }

  async search(
    query: string,
    options?: VectorSearchOptions
  ): Promise<VectorSearchResult<T>[]> {
    this.ensureExtension();
    this.ensureTables();

    const limit = options?.limit ?? 10;
    const threshold = options?.threshold;

    const queryVector = await this.embed(query, "search");
    const vectorLiteral = this.serializeVector(queryVector, "search");

    const rows = this.db
      .prepare<SqliteVecRow>(
        `SELECT base.key as key, base.data as data, base.created_at as created_at, base.updated_at as updated_at, base.metadata as metadata, vec.distance as distance
         FROM ${this.vectorTableName} AS vec
         JOIN ${this.tableName} AS base ON base.rowid = vec.rowid
         WHERE vec.embedding MATCH ?
           AND k = ?`
      )
      .all(vectorLiteral, limit);

    const results: VectorSearchResult<T>[] = [];

    for (const row of rows) {
      const score = this.scoreFromDistance(row.distance ?? 0);

      if (threshold !== undefined && score < threshold) {
        continue;
      }

      const data = JSON.parse(row.data) as T;
      const metadata =
        row.metadata === null
          ? undefined
          : (JSON.parse(row.metadata) as Record<string, unknown>);

      results.push({
        key: row.key,
        score,
        entry: {
          data,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          ...(metadata && { metadata }),
        },
      });
    }

    return results;
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
