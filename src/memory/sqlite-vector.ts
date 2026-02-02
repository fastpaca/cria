import { createClient, type Row, type Value } from "@libsql/client";
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

export type VectorMetric = "cosine" | "l2";

export type VectorColumnType =
  | "F64_BLOB"
  | "FLOAT64"
  | "F32_BLOB"
  | "FLOAT32"
  | "F16_BLOB"
  | "FLOAT16"
  | "F8_BLOB"
  | "FLOAT8"
  | "F1BIT_BLOB"
  | "FLOAT1BIT";

type VectorFunction =
  | "vector64"
  | "vector32"
  | "vector16"
  | "vectorb16"
  | "vector8"
  | "vector1bit";

const VECTOR_TYPE_TO_FUNCTION: Record<VectorColumnType, VectorFunction> = {
  F64_BLOB: "vector64",
  FLOAT64: "vector64",
  F32_BLOB: "vector32",
  FLOAT32: "vector32",
  F16_BLOB: "vector16",
  FLOAT16: "vector16",
  F8_BLOB: "vector8",
  FLOAT8: "vector8",
  F1BIT_BLOB: "vector1bit",
  FLOAT1BIT: "vector1bit",
};

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
export interface SqliteVectorStoreOptions {
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
   * Vector index name.
   * @default derived from tableName
   */
  indexName?: string;
  /**
   * Vector column type.
   * @default "F32_BLOB"
   */
  vectorType?: VectorColumnType;
  /**
   * Vector distance metric used by the index and scoring.
   * @default "cosine"
   */
  metric?: VectorMetric;
  /**
   * Additional libsql_vector_idx settings (e.g. "compress_neighbors=float8").
   */
  indexOptions?: string[];
  /**
   * Whether to create the table on first use if it doesn't exist.
   * @default true
   */
  autoCreateTable?: boolean;
  /**
   * Whether to create the vector index on first use if it doesn't exist.
   * @default true
   */
  autoCreateIndex?: boolean;
  /**
   * Vector dimensionality (must match embedding length).
   */
  dimensions: number;
  /**
   * Function to generate embeddings from text.
   */
  embed: EmbeddingFunction;
}

const DEFAULT_VECTOR_TABLE_NAME = "cria_vector_store";
const DEFAULT_VECTOR_INDEX_SUFFIX = "_vector_idx";
const DEFAULT_VECTOR_TYPE: VectorColumnType = "F32_BLOB";
const DEFAULT_VECTOR_METRIC: VectorMetric = "cosine";

const serializeData = <T>(data: T): string => JSON.stringify(data);

const deserializeData = <T>(data: string): T => JSON.parse(data) as T;

const readValue = (row: Row, column: string): Value => {
  const value = row[column];
  if (value === undefined) {
    throw new Error(`SqliteVectorStore: missing column "${column}"`);
  }
  return value;
};

const readString = (row: Row, column: string): string => {
  const value = readValue(row, column);
  if (typeof value !== "string") {
    throw new Error(`SqliteVectorStore: "${column}" must be a string`);
  }
  return value;
};

const readNullableString = (row: Row, column: string): string | null => {
  const value = readValue(row, column);
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`SqliteVectorStore: "${column}" must be a string or null`);
  }
  return value;
};

const readNumber = (row: Row, column: string): number => {
  const value = readValue(row, column);
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    const coerced = Number(value);
    if (!Number.isFinite(coerced)) {
      throw new Error(
        `SqliteVectorStore: "${column}" bigint is not a safe number`
      );
    }
    return coerced;
  }
  throw new Error(`SqliteVectorStore: "${column}" must be a number`);
};

const parseVectorRow = (row: Row): SqliteVectorRow => ({
  key: readString(row, "key"),
  data: readString(row, "data"),
  created_at: readNumber(row, "created_at"),
  updated_at: readNumber(row, "updated_at"),
  metadata: readNullableString(row, "metadata"),
});

const parseVectorSearchRow = (row: Row): SqliteVectorSearchRow => ({
  ...parseVectorRow(row),
  distance: readNumber(row, "distance"),
});

const normalizeIdentifier = (value: string): string =>
  value.replace(/[^A-Za-z0-9_]/g, "_");

const buildIndexName = (tableName: string): string =>
  `${normalizeIdentifier(tableName)}${DEFAULT_VECTOR_INDEX_SUFFIX}`;

const assertValidDimensions = (dimensions: number): void => {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error("SqliteVectorStore: dimensions must be a positive integer");
  }
  if (dimensions > 65_536) {
    throw new Error("SqliteVectorStore: dimensions must be 65536 or fewer");
  }
};

const ensureEmbeddingDimensions = (
  embedding: number[],
  dimensions: number,
  context: string
): void => {
  if (embedding.length !== dimensions) {
    throw new Error(
      `SqliteVectorStore: ${context} embedding length (${embedding.length}) does not match dimensions (${dimensions})`
    );
  }

  for (const value of embedding) {
    if (!Number.isFinite(value)) {
      throw new Error(
        `SqliteVectorStore: ${context} embedding contains non-finite values`
      );
    }
  }
};

const normalizeIndexOptions = (options?: string[]): string[] =>
  options
    ?.map((option) => option.trim())
    .filter((option) => option.length > 0) ?? [];

const extractMetricOption = (options: string[]): VectorMetric | undefined => {
  const metricOption = options.find((option) => option.startsWith("metric="));
  if (!metricOption) {
    return undefined;
  }

  const [, value] = metricOption.split("=");
  if (value === "cosine" || value === "l2") {
    return value;
  }

  throw new Error(
    `SqliteVectorStore: unsupported metric option (${metricOption})`
  );
};

const buildIndexOptions = (
  metric: VectorMetric,
  options: string[]
): string[] => {
  const metricOption = options.find((option) => option.startsWith("metric="));

  if (metricOption && metricOption !== `metric=${metric}`) {
    throw new Error(
      `SqliteVectorStore: metric option (${metricOption}) does not match metric (${metric})`
    );
  }

  return metricOption ? options : [`metric=${metric}`, ...options];
};

const serializeVector = (embedding: number[]): string =>
  JSON.stringify(embedding);

const scoreFromDistance = (distance: number, metric: VectorMetric): number => {
  if (metric === "l2") {
    return 1 / (1 + distance);
  }

  const rawScore = 1 - distance / 2;
  if (rawScore <= 0) {
    return 0;
  }
  if (rawScore >= 1) {
    return 1;
  }
  return rawScore;
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
 * import { SqliteVectorStore } from "@fastpaca/cria/memory/sqlite-vector";
 *
 * const store = new SqliteVectorStore<string>({
 *   filename: "cria.sqlite",
 *   dimensions: 1536,
 *   embed: async (text) => getEmbedding(text),
 * });
 *
 * const results = await store.search("What is RAG?", { limit: 5 });
 * ```
 */
export class SqliteVectorStore<T = unknown> implements VectorMemory<T> {
  private readonly db: SqliteDatabase;
  private readonly tableName: string;
  private readonly indexName: string;
  private readonly vectorType: VectorColumnType;
  private readonly vectorFunction: VectorFunction;
  private readonly metric: VectorMetric;
  private readonly indexOptions: string[];
  private readonly autoCreateTable: boolean;
  private readonly autoCreateIndex: boolean;
  private readonly embedFn: EmbeddingFunction;
  private readonly dimensions: number;
  private tableCreated = false;
  private indexCreated = false;

  constructor(options: SqliteVectorStoreOptions) {
    const {
      filename = ":memory:",
      options: dbOptions,
      database,
      tableName = DEFAULT_VECTOR_TABLE_NAME,
      indexName,
      vectorType = DEFAULT_VECTOR_TYPE,
      metric,
      indexOptions,
      autoCreateTable = true,
      autoCreateIndex = true,
      dimensions,
      embed,
    } = options;

    assertValidDimensions(dimensions);

    const normalizedIndexOptions = normalizeIndexOptions(indexOptions);
    const metricFromOptions = extractMetricOption(normalizedIndexOptions);
    const resolvedMetric = metric ?? metricFromOptions ?? DEFAULT_VECTOR_METRIC;

    if (metricFromOptions && metricFromOptions !== resolvedMetric) {
      throw new Error(
        `SqliteVectorStore: metric option (${metricFromOptions}) does not match metric (${resolvedMetric})`
      );
    }

    if (
      resolvedMetric === "l2" &&
      (vectorType === "F1BIT_BLOB" || vectorType === "FLOAT1BIT")
    ) {
      throw new Error(
        "SqliteVectorStore: l2 metric is not supported for 1-bit vector types"
      );
    }

    this.db =
      database ??
      createClient({
        url: filename === ":memory:" ? ":memory:" : `file:${filename}`,
        ...dbOptions,
      });
    this.tableName = tableName;
    this.indexName = indexName ?? buildIndexName(tableName);
    this.vectorType = vectorType;
    this.vectorFunction = VECTOR_TYPE_TO_FUNCTION[vectorType];
    this.metric = resolvedMetric;
    this.indexOptions = buildIndexOptions(
      resolvedMetric,
      normalizedIndexOptions
    );
    this.autoCreateTable = autoCreateTable;
    this.autoCreateIndex = autoCreateIndex;
    this.embedFn = embed;
    this.dimensions = dimensions;
  }

  private async ensureTable(): Promise<void> {
    if (this.tableCreated || !this.autoCreateTable) {
      return;
    }

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        embedding ${this.vectorType}(${this.dimensions}) NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT
      )
    `);

    this.tableCreated = true;
  }

  private async ensureIndex(): Promise<void> {
    if (this.indexCreated || !this.autoCreateIndex) {
      return;
    }

    const settings = this.indexOptions
      .map((option) => `'${option}'`)
      .join(", ");
    const settingsClause = settings.length > 0 ? `, ${settings}` : "";

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS ${this.indexName}
      ON ${this.tableName} (libsql_vector_idx(embedding${settingsClause}))
    `);

    this.indexCreated = true;
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

    const parsed = parseVectorRow(row);
    const metadata =
      parsed.metadata === null
        ? undefined
        : (JSON.parse(parsed.metadata) as Record<string, unknown>);

    return {
      data: deserializeData<T>(parsed.data),
      createdAt: parsed.created_at,
      updatedAt: parsed.updated_at,
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
    const serializedData = serializeData(data);
    const serializedMetadata =
      metadata !== undefined ? JSON.stringify(metadata) : null;

    const textToEmbed = typeof data === "string" ? data : serializedData;
    const embedding = await this.embedFn(textToEmbed);
    ensureEmbeddingDimensions(embedding, this.dimensions, "stored");

    await this.db.execute({
      sql: `
        INSERT INTO ${this.tableName} (key, data, embedding, created_at, updated_at, metadata)
        VALUES (?, ?, ${this.vectorFunction}(?), ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          data = excluded.data,
          embedding = excluded.embedding,
          updated_at = excluded.updated_at,
          metadata = excluded.metadata
      `,
      args: [
        key,
        serializedData,
        serializeVector(embedding),
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

    const rawLimit = options?.limit ?? 10;
    if (!Number.isFinite(rawLimit)) {
      throw new Error("SqliteVectorStore: limit must be a finite number");
    }
    const limit = Math.max(0, Math.trunc(rawLimit));
    const threshold = options?.threshold;

    const queryVector = await this.embedFn(query);
    ensureEmbeddingDimensions(queryVector, this.dimensions, "query");
    const serializedQuery = serializeVector(queryVector);

    const distanceFn =
      this.metric === "l2" ? "vector_distance_l2" : "vector_distance_cos";

    const result = await this.db.execute({
      sql: `
        SELECT
          t.key,
          t.data,
          t.created_at,
          t.updated_at,
          t.metadata,
          ${distanceFn}(t.embedding, ${this.vectorFunction}(?)) AS distance
        FROM vector_top_k(
          ?,
          ${this.vectorFunction}(?),
          CAST(? AS INTEGER)
        ) AS i
        JOIN ${this.tableName} AS t ON t.rowid = i.id
        ORDER BY distance ASC
      `,
      args: [serializedQuery, this.indexName, serializedQuery, limit],
    });

    const results: VectorSearchResult<T>[] = [];

    for (const row of result.rows) {
      const parsed = parseVectorSearchRow(row);
      const score = scoreFromDistance(parsed.distance, this.metric);

      if (threshold !== undefined && score < threshold) {
        continue;
      }

      const metadata =
        parsed.metadata === null
          ? undefined
          : (JSON.parse(parsed.metadata) as Record<string, unknown>);

      results.push({
        key: parsed.key,
        score,
        entry: {
          data: deserializeData<T>(parsed.data),
          createdAt: parsed.created_at,
          updatedAt: parsed.updated_at,
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
