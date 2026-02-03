import { createClient } from "@libsql/client";
import { z } from "zod";
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

interface SqliteVectorRow {
  key: string;
  data: string;
  created_at: number;
  updated_at: number;
  metadata: string | null;
}

interface SqliteVectorSearchRow extends SqliteVectorRow {
  distance: number;
}

/**
 * Configuration options for the SQLite vector store.
 */
export interface SqliteVectorStoreOptions<T = unknown> {
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
   * @default "cria_vector_store"
   */
  tableName?: string;
  /**
   * Vector dimensionality (must match embedding length).
   */
  dimensions: number;
  /**
   * Function to generate embeddings from text.
   */
  embed: EmbeddingFunction;
  /**
   * Schema for validating stored data.
   */
  schema: z.ZodType<T>;
}

const DEFAULT_VECTOR_TABLE_NAME = "cria_vector_store";
const VECTOR_TYPE = "F32_BLOB";
const VECTOR_FN = "vector32";
const VECTOR_INDEX_SUFFIX = "_vector_idx";
const metadataSchema = z.object({}).catchall(z.unknown());

const normalizeIdentifier = (value: string): string =>
  value.replace(/[^A-Za-z0-9_]/g, "_");

const buildIndexName = (tableName: string): string =>
  `${normalizeIdentifier(tableName)}${VECTOR_INDEX_SUFFIX}`;

const scoreFromDistance = (distance: number): number => {
  const score = 1 - distance / 2;
  return Math.max(0, Math.min(1, score));
};

/**
 * SQLite-backed implementation of VectorMemory.
 *
 * Uses libSQL vector columns and vector indexes for DB-side similarity search.
 *
 * @template T - The type of data to store
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 * import { SqliteVectorStore } from "@fastpaca/cria/memory/sqlite-vector";
 *
 * const store = new SqliteVectorStore<string>({
 *   filename: "cria.sqlite",
 *   dimensions: 1536,
 *   embed: async (text) => getEmbedding(text),
 *   schema: z.string(),
 * });
 *
 * const results = await store.search("What is RAG?", { limit: 5 });
 * ```
 */
export class SqliteVectorStore<T = unknown> implements VectorMemory<T> {
  private readonly db: SqliteDatabase;
  private readonly tableName: string;
  private readonly indexName: string;
  private readonly embedFn: EmbeddingFunction;
  private readonly dimensions: number;
  private readonly schema: z.ZodType<T>;
  private readonly embeddingSchema: z.ZodType<number[]>;
  private tableCreated = false;
  private indexCreated = false;

  constructor(options: SqliteVectorStoreOptions<T>) {
    const {
      filename = ":memory:",
      options: dbOptions,
      database,
      tableName = DEFAULT_VECTOR_TABLE_NAME,
      dimensions,
      embed,
      schema,
    } = options;

    this.db =
      database ??
      createClient({
        url: filename === ":memory:" ? ":memory:" : `file:${filename}`,
        ...dbOptions,
      });
    this.tableName = tableName;
    this.indexName = buildIndexName(tableName);
    this.embedFn = embed;
    this.dimensions = dimensions;
    this.schema = schema;
    this.embeddingSchema = z.array(z.number()).length(dimensions);
  }

  private async ensureTable(): Promise<void> {
    if (this.tableCreated) {
      return;
    }

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        embedding ${VECTOR_TYPE}(${this.dimensions}) NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT
      )
    `);

    this.tableCreated = true;
  }

  private async ensureIndex(): Promise<void> {
    if (this.indexCreated) {
      return;
    }

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS ${this.indexName}
      ON ${this.tableName} (
        libsql_vector_idx(embedding, 'metric=cosine')
      )
    `);

    this.indexCreated = true;
  }

  async get(key: string): Promise<MemoryEntry<T> | null> {
    await this.ensureTable();

    const result = await this.db.execute({
      sql: `SELECT key, data, created_at, updated_at, metadata FROM ${this.tableName} WHERE key = ?`,
      args: [key],
    });

    const row = result.rows[0] as SqliteVectorRow | undefined;
    if (!row) {
      return null;
    }

    const data = this.schema.parse(JSON.parse(row.data));
    const metadata =
      row.metadata === null
        ? undefined
        : metadataSchema.parse(JSON.parse(row.metadata));

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
    await this.ensureTable();
    await this.ensureIndex();

    const now = Date.now();
    const parsedData = this.schema.parse(data);
    const serializedData = JSON.stringify(parsedData);
    const serializedMetadata =
      metadata === undefined
        ? null
        : JSON.stringify(metadataSchema.parse(metadata));

    const textToEmbed =
      typeof parsedData === "string" ? parsedData : serializedData;
    const embedding = this.embeddingSchema.parse(
      await this.embedFn(textToEmbed)
    );

    await this.db.execute({
      sql: `
        INSERT INTO ${this.tableName} (key, data, embedding, created_at, updated_at, metadata)
        VALUES (?, ?, ${VECTOR_FN}(?), ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          data = excluded.data,
          embedding = excluded.embedding,
          updated_at = excluded.updated_at,
          metadata = excluded.metadata
      `,
      args: [
        key,
        serializedData,
        JSON.stringify(embedding),
        now,
        now,
        serializedMetadata,
      ],
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

  async search(
    query: string,
    options?: VectorSearchOptions
  ): Promise<VectorSearchResult<T>[]> {
    await this.ensureTable();
    await this.ensureIndex();

    const limit = Math.max(0, Math.trunc(options?.limit ?? 10));
    const threshold = options?.threshold;

    const queryVector = this.embeddingSchema.parse(await this.embedFn(query));
    const serializedQuery = JSON.stringify(queryVector);

    const result = await this.db.execute({
      sql: `
        SELECT
          t.key,
          t.data,
          t.created_at,
          t.updated_at,
          t.metadata,
          i.distance AS distance
        FROM vector_top_k(
          ?,
          ${VECTOR_FN}(?),
          CAST(? AS INTEGER)
        ) AS i
        JOIN ${this.tableName} AS t ON t.rowid = i.id
        ORDER BY i.distance ASC
      `,
      args: [this.indexName, serializedQuery, limit],
    });

    const rows = result.rows as unknown as SqliteVectorSearchRow[];
    const results: VectorSearchResult<T>[] = [];

    for (const row of rows) {
      const score = scoreFromDistance(row.distance);

      if (threshold !== undefined && score < threshold) {
        continue;
      }

      const data = this.schema.parse(JSON.parse(row.data));
      const metadata =
        row.metadata === null
          ? undefined
          : metadataSchema.parse(JSON.parse(row.metadata));

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
