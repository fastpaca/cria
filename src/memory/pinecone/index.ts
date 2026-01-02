import type { Index, RecordMetadata } from "@pinecone-database/pinecone";
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
 * Options for creating a PineconeStore.
 */
export interface PineconeStoreOptions<T extends RecordMetadata> {
  /** The Pinecone index to use */
  index: Index<T>;
  /** Function to generate embeddings from text */
  embed: EmbeddingFunction;
  /** Optional namespace within the index */
  namespace?: string;
}

/**
 * VectorMemory implementation backed by Pinecone.
 *
 * This adapter wraps a Pinecone index and implements the VectorMemory interface,
 * allowing you to use Pinecone for RAG workflows with Cria's VectorSearch component.
 *
 * @template T - The type of metadata stored with each vector
 *
 * @example
 * ```typescript
 * import { Pinecone } from "@pinecone-database/pinecone";
 * import { PineconeStore } from "@fastpaca/cria/memory/pinecone";
 * import { VectorSearch } from "@fastpaca/cria";
 *
 * const pc = new Pinecone();
 * const index = pc.index<{ content: string }>("my-index");
 *
 * const store = new PineconeStore({
 *   index,
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
export class PineconeStore<T extends RecordMetadata = RecordMetadata>
  implements VectorMemory<T>
{
  private readonly index: Index<T>;
  private readonly embed: EmbeddingFunction;
  private readonly namespace: string | undefined;

  constructor(options: PineconeStoreOptions<T>) {
    this.index = options.index;
    this.embed = options.embed;
    this.namespace = options.namespace;
  }

  async get(key: string): Promise<MemoryEntry<T> | null> {
    const ns = this.namespace
      ? this.index.namespace(this.namespace)
      : this.index;
    const response = await ns.fetch([key]);
    const record = response.records[key];

    if (!record?.metadata) {
      return null;
    }

    return {
      data: record.metadata as T,
      createdAt: Date.now(), // Pinecone doesn't store timestamps
      updatedAt: Date.now(),
    };
  }

  async set(
    key: string,
    data: T,
    _metadata?: Record<string, unknown>
  ): Promise<void> {
    // Convert data to text for embedding
    const textToEmbed = typeof data === "string" ? data : JSON.stringify(data);
    const vector = await this.embed(textToEmbed);

    const ns = this.namespace
      ? this.index.namespace(this.namespace)
      : this.index;
    await ns.upsert([
      {
        id: key,
        values: vector,
        metadata: data,
      },
    ]);
  }

  async delete(key: string): Promise<boolean> {
    const ns = this.namespace
      ? this.index.namespace(this.namespace)
      : this.index;
    await ns.deleteOne(key);
    return true; // Pinecone doesn't return whether the record existed
  }

  async search(
    query: string,
    options?: VectorSearchOptions
  ): Promise<VectorSearchResult<T>[]> {
    const limit = options?.limit ?? 10;
    const threshold = options?.threshold;

    const queryVector = await this.embed(query);

    const ns = this.namespace
      ? this.index.namespace(this.namespace)
      : this.index;
    const response = await ns.query({
      vector: queryVector,
      topK: limit,
      includeMetadata: true,
    });

    const results: VectorSearchResult<T>[] = [];

    for (const match of response.matches) {
      const score = match.score ?? 0;

      // Apply threshold filter
      if (threshold !== undefined && score < threshold) {
        continue;
      }

      if (!match.metadata) {
        continue;
      }

      results.push({
        key: match.id,
        score,
        entry: {
          data: match.metadata as T,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
    }

    return results;
  }
}
