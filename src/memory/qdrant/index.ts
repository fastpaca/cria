import type { QdrantClient } from "@qdrant/js-client-rest";
import { z } from "zod";
import type { MemoryEntry } from "../key-value";
import type {
  VectorSearchFilter,
  VectorSearchOptions,
  VectorSearchResult,
  VectorStore,
} from "../vector-store";

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

const QdrantPayloadSchema = z
  .object({
    data: z.unknown(),
    createdAt: z.number(),
    updatedAt: z.number(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .transform((payload) => ({
    data: payload.data,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    ...(payload.metadata && { metadata: payload.metadata }),
  }));

const buildQdrantFilter = (
  filter: VectorSearchFilter | undefined
):
  | {
      must: Array<{
        key: string;
        match: { value: string | number | boolean };
      }>;
    }
  | undefined => {
  if (filter === undefined) {
    return undefined;
  }

  const entries = Object.entries(filter);
  if (entries.length === 0) {
    return undefined;
  }

  return {
    must: entries.map(([key, value]) => ({
      key: `metadata.${key}`,
      match: { value },
    })),
  };
};

/**
 * VectorStore implementation backed by Qdrant.
 *
 * This adapter wraps a Qdrant collection and implements the VectorStore interface,
 * allowing you to use Qdrant for RAG workflows with Cria's vectordb helper.
 *
 * @template T - The type of data stored in the payload
 *
 * @example
 * ```typescript
 * import { QdrantClient } from "@qdrant/js-client-rest";
 * import { QdrantStore } from "@fastpaca/cria/memory/qdrant";
 * import { cria } from "@fastpaca/cria";
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
 * const vectors = cria.vectordb(store);
 * const retrieval = vectors.plugin({ query: "What is RAG?", limit: 5 });
 *
 * cria.prompt().use(retrieval);
 * ```
 */
export class QdrantStore<T = unknown> implements VectorStore<T> {
  private readonly client: QdrantClient;
  private readonly collectionName: string;
  private readonly embedFn: EmbeddingFunction;
  private readonly vectorName: string | undefined;

  constructor(options: QdrantStoreOptions) {
    this.client = options.client;
    this.collectionName = options.collectionName;
    this.embedFn = options.embed;
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

    if (!point.payload) {
      throw new Error("QdrantStore: payload is missing from entry");
    }

    return QdrantPayloadSchema.parse(point.payload) as MemoryEntry<T>;
  }

  async set(
    key: string,
    data: T,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const now = Date.now();

    // Convert data to text for embedding
    const textToEmbed = typeof data === "string" ? data : JSON.stringify(data);
    const vector = await this.embedFn(textToEmbed);

    const payload = {
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
    const filter = buildQdrantFilter(options?.filter);

    const queryVector = await this.embedFn(query);

    const response = await this.client.search(this.collectionName, {
      vector: this.vectorName
        ? { name: this.vectorName, vector: queryVector }
        : queryVector,
      limit,
      with_payload: true,
      ...(threshold !== undefined && { score_threshold: threshold }),
      ...(filter !== undefined && { filter }),
    });

    const results: VectorSearchResult<T>[] = [];

    for (const point of response) {
      if (!point.payload) {
        throw new Error("QdrantStore: payload is missing from entry");
      }

      const entry = QdrantPayloadSchema.parse(point.payload) as MemoryEntry<T>;

      results.push({
        key: String(point.id),
        score: point.score,
        entry,
      });
    }

    return results;
  }
}
