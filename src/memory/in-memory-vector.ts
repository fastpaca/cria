import type { MemoryEntry } from "./key-value";
import type {
  VectorMemory,
  VectorSearchOptions,
  VectorSearchResult,
} from "./vector";

/**
 * Function that converts text to an embedding vector.
 */
export type EmbedFunction = (text: string) => Promise<number[]> | number[];

interface StoredEntry<T> {
  entry: MemoryEntry<T>;
  vector: number[];
}

/**
 * Computes cosine similarity between two vectors.
 * Returns a value between -1 and 1, where 1 means identical direction.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0;
    const bVal = b[i] ?? 0;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) {
    return 0;
  }

  return dotProduct / magnitude;
}

/**
 * Normalizes a cosine similarity score to 0-1 range.
 * Cosine similarity ranges from -1 to 1, we map it to 0 to 1.
 */
function normalizeScore(cosineSim: number): number {
  return (cosineSim + 1) / 2;
}

interface InMemoryVectorStoreOptions {
  /**
   * Function to embed text into vectors.
   * Use your preferred embedding provider (OpenAI, Cohere, local model, etc.)
   */
  embed: EmbedFunction;
}

/**
 * In-memory vector store implementation for testing and development.
 *
 * This store uses cosine similarity for semantic search. For production use,
 * consider using a dedicated vector database like Chroma or Qdrant.
 *
 * @template T - The type of data stored in the entries
 *
 * @example
 * ```typescript
 * import { InMemoryVectorStore } from "@fastpaca/cria";
 * import OpenAI from "openai";
 *
 * const openai = new OpenAI();
 *
 * const store = new InMemoryVectorStore<string>({
 *   embed: async (text) => {
 *     const response = await openai.embeddings.create({
 *       model: "text-embedding-3-small",
 *       input: text,
 *     });
 *     return response.data[0].embedding;
 *   },
 * });
 *
 * await store.set("doc1", "The quick brown fox");
 * await store.set("doc2", "A lazy dog");
 *
 * const results = await store.search("fast fox", { limit: 1 });
 * // Returns doc1 as the most similar
 * ```
 */
export class InMemoryVectorStore<T = unknown> implements VectorMemory<T> {
  private readonly store = new Map<string, StoredEntry<T>>();
  private readonly embed: EmbedFunction;

  constructor(options: InMemoryVectorStoreOptions) {
    this.embed = options.embed;
  }

  get(key: string): MemoryEntry<T> | null {
    const stored = this.store.get(key);
    return stored?.entry ?? null;
  }

  async set(
    key: string,
    data: T,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const now = Date.now();
    const existing = this.store.get(key);

    // Convert data to text for embedding
    const textToEmbed = typeof data === "string" ? data : JSON.stringify(data);
    const vector = await this.embed(textToEmbed);

    const entry: MemoryEntry<T> = {
      data,
      createdAt: existing?.entry.createdAt ?? now,
      updatedAt: now,
      ...(metadata && { metadata }),
    };

    this.store.set(key, { entry, vector });
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  async search(
    query: string,
    options?: VectorSearchOptions
  ): Promise<VectorSearchResult<T>[]> {
    const limit = options?.limit ?? 10;
    const threshold = options?.threshold ?? 0;

    if (this.store.size === 0) {
      return [];
    }

    const queryVector = await this.embed(query);
    const results: VectorSearchResult<T>[] = [];

    for (const [key, stored] of this.store) {
      const cosineSim = cosineSimilarity(queryVector, stored.vector);
      const score = normalizeScore(cosineSim);

      if (score >= threshold) {
        results.push({
          key,
          score,
          entry: stored.entry,
        });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Limit results
    return results.slice(0, limit);
  }

  /**
   * Returns the number of entries in the store.
   */
  size(): number {
    return this.store.size;
  }

  /**
   * Clears all entries from the store.
   */
  clear(): void {
    this.store.clear();
  }
}
