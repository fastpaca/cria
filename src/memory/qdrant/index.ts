import type { QdrantClient } from "@qdrant/js-client-rest";
import type { ZodType } from "zod";
import type { MemoryEntry } from "../key-value";
import type {
  VectorMemory,
  VectorSearchOptions,
  VectorSearchResult,
} from "../vector";

/**
 * Function to generate embeddings for text.
 */
export type EmbeddingFunction = (text: string) => Promise<number[]>;

/**
 * Options for creating a QdrantStore.
 */
export interface QdrantStoreOptions<T> {
  /** The Qdrant client instance */
  client: QdrantClient;
  /** The name of the collection to use */
  collectionName: string;
  /** Function to generate embeddings from text */
  embed: EmbeddingFunction;
  /** Optional: the name of the vector field (for collections with named vectors) */
  vectorName?: string;
  /** Schema used to validate stored data at read boundaries. */
  schema: ZodType<T>;
}

/**
 * Internal payload structure stored in Qdrant.
 */
interface QdrantPayload<T> {
  data: T;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * Convert a Qdrant payload to a MemoryEntry.
 */
function payloadToEntry<T>(payload: QdrantPayload<T>): MemoryEntry<T> {
  return {
    data: payload.data,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    ...(payload.metadata && { metadata: payload.metadata }),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parsePayload<T>(
  payload: unknown,
  schema: ZodType<T>,
  context: string
): QdrantPayload<T> | null {
  if (!isRecord(payload)) {
    return null;
  }

  const createdAt = payload.createdAt;
  const updatedAt = payload.updatedAt;

  if (typeof createdAt !== "number" || typeof updatedAt !== "number") {
    throw new Error(
      `QdrantStore: payload is missing createdAt/updatedAt during ${context}`
    );
  }

  let data: T;
  try {
    data = schema.parse(payload.data);
  } catch (error) {
    throw new Error(
      `QdrantStore: payload failed schema validation during ${context}`,
      {
        cause: error,
      }
    );
  }

  const metadata = payload.metadata;
  if (metadata !== undefined && metadata !== null && !isRecord(metadata)) {
    throw new Error(
      `QdrantStore: payload metadata must be an object if present during ${context}`
    );
  }

  return {
    data,
    createdAt,
    updatedAt,
    ...(metadata ? { metadata } : {}),
  };
}

/**
 * VectorMemory implementation backed by Qdrant.
 *
 * This adapter wraps a Qdrant collection and implements the VectorMemory interface,
 * allowing you to use Qdrant for RAG workflows with Cria's VectorSearch component.
 *
 * @template T - The type of data stored in the payload
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 * import { QdrantClient } from "@qdrant/js-client-rest";
 * import { QdrantStore } from "@fastpaca/cria/memory/qdrant";
 * import { VectorSearch } from "@fastpaca/cria";
 *
 * const client = new QdrantClient({ url: "http://localhost:6333" });
 *
 * const store = new QdrantStore({
 *   client,
 *   collectionName: "my-docs",
 *   embed: async (text) => {
 *     // Use your embedding model (OpenAI, Cohere, etc.)
 *     return await getEmbedding(text);
 *   },
 *   schema: z.string(),
 * });
 *
 * // Use with VectorSearch
 * <VectorSearch store={store} limit={5}>
 *   What is RAG?
 * </VectorSearch>
 * ```
 */
export class QdrantStore<T = unknown> implements VectorMemory<T> {
  private readonly client: QdrantClient;
  private readonly collectionName: string;
  private readonly embedFn: EmbeddingFunction;
  private readonly vectorName: string | undefined;
  private readonly schema: ZodType<T>;

  constructor(options: QdrantStoreOptions<T>) {
    this.client = options.client;
    this.collectionName = options.collectionName;
    this.embedFn = options.embed;
    this.vectorName = options.vectorName;
    this.schema = options.schema;
  }

  private async embed(text: string, context: string): Promise<number[]> {
    try {
      return await this.embedFn(text);
    } catch (error) {
      throw new Error(`QdrantStore: embedding failed during ${context}`, {
        cause: error,
      });
    }
  }

  async get(key: string): Promise<MemoryEntry<T> | null> {
    const response = await this.client.retrieve(this.collectionName, {
      ids: [key],
      with_payload: true,
    });

    const point = response[0];
    if (!point) {
      return null;
    }

    const payload = parsePayload(point.payload, this.schema, `get("${key}")`);

    return payload ? payloadToEntry(payload) : null;
  }

  async set(
    key: string,
    data: T,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const now = Date.now();

    // Convert data to text for embedding
    const textToEmbed = typeof data === "string" ? data : JSON.stringify(data);
    const vector = await this.embed(textToEmbed, `set("${key}")`);

    const payload: QdrantPayload<T> = {
      data,
      createdAt: now,
      updatedAt: now,
      ...(metadata && { metadata }),
    };

    await this.client.upsert(this.collectionName, {
      wait: true,
      points: [
        {
          id: key,
          vector: this.vectorName ? { [this.vectorName]: vector } : vector,
          payload,
        },
      ],
    });
  }

  async delete(key: string): Promise<boolean> {
    const existing = await this.get(key);
    if (!existing) {
      return false;
    }
    await this.client.delete(this.collectionName, {
      wait: true,
      points: [key],
    });
    return true;
  }

  async search(
    query: string,
    options?: VectorSearchOptions
  ): Promise<VectorSearchResult<T>[]> {
    const limit = options?.limit ?? 10;
    const threshold = options?.threshold;

    const queryVector = await this.embed(query, "search");

    const response = await this.client.search(this.collectionName, {
      vector: this.vectorName
        ? { name: this.vectorName, vector: queryVector }
        : queryVector,
      limit,
      with_payload: true,
      ...(threshold !== undefined && { score_threshold: threshold }),
    });

    const results: VectorSearchResult<T>[] = [];

    for (const point of response) {
      const payload = parsePayload(
        point.payload,
        this.schema,
        `search("${query}")`
      );

      if (!payload) {
        continue;
      }

      results.push({
        key: String(point.id),
        score: point.score,
        entry: payloadToEntry(payload),
      });
    }

    return results;
  }
}
