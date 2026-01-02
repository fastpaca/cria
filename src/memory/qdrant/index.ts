import type { QdrantClient } from "@qdrant/js-client-rest";
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
export interface QdrantStoreOptions {
  /** The Qdrant client instance */
  client: QdrantClient;
  /** The name of the collection to use */
  collectionName: string;
  /** Function to generate embeddings from text */
  embed: EmbeddingFunction;
  /** Optional: the name of the vector field (for collections with named vectors) */
  vectorName?: string;
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
 * VectorMemory implementation backed by Qdrant.
 *
 * This adapter wraps a Qdrant collection and implements the VectorMemory interface,
 * allowing you to use Qdrant for RAG workflows with Cria's VectorSearch component.
 *
 * @template T - The type of data stored in the payload
 *
 * @example
 * ```typescript
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
 * });
 *
 * // Use with VectorSearch
 * const results = await store.search("What is RAG?", { limit: 5 });
 * <VectorSearch results={results} />
 * ```
 */
export class QdrantStore<T = unknown> implements VectorMemory<T> {
  private readonly client: QdrantClient;
  private readonly collectionName: string;
  private readonly embed: EmbeddingFunction;
  private readonly vectorName: string | undefined;

  constructor(options: QdrantStoreOptions) {
    this.client = options.client;
    this.collectionName = options.collectionName;
    this.embed = options.embed;
    this.vectorName = options.vectorName;
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

    const payload = point.payload as QdrantPayload<T> | undefined;

    if (!payload) {
      return null;
    }

    return {
      data: payload.data,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
      ...(payload.metadata && { metadata: payload.metadata }),
    };
  }

  async set(
    key: string,
    data: T,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const now = Date.now();

    // Convert data to text for embedding
    const textToEmbed = typeof data === "string" ? data : JSON.stringify(data);
    const vector = await this.embed(textToEmbed);

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
          payload: payload as unknown as Record<string, unknown>,
        },
      ],
    });
  }

  async delete(key: string): Promise<boolean> {
    await this.client.delete(this.collectionName, {
      wait: true,
      points: [key],
    });
    return true; // Qdrant doesn't return whether the record existed
  }

  async search(
    query: string,
    options?: VectorSearchOptions
  ): Promise<VectorSearchResult<T>[]> {
    const limit = options?.limit ?? 10;
    const threshold = options?.threshold;

    const queryVector = await this.embed(query);

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
      const payload = point.payload as QdrantPayload<T> | undefined;

      if (!payload) {
        continue;
      }

      results.push({
        key: String(point.id),
        score: point.score,
        entry: {
          data: payload.data,
          createdAt: payload.createdAt,
          updatedAt: payload.updatedAt,
          ...(payload.metadata && { metadata: payload.metadata }),
        },
      });
    }

    return results;
  }
}
