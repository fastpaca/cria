import { type Collection, IncludeEnum, type Metadata } from "chromadb";
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
 * Options for creating a ChromaStore.
 */
export interface ChromaStoreOptions {
  /** The Chroma collection to use */
  collection: Collection;
  /** Function to generate embeddings from text */
  embed: EmbeddingFunction;
}

/**
 * Parse a document string as JSON, falling back to the raw string.
 */
function parseDocument<T>(
  document: string | null | undefined,
  fallback: Metadata | null | undefined
): T {
  if (document) {
    try {
      return JSON.parse(document) as T;
    } catch {
      return document as T;
    }
  }
  return (fallback ?? {}) as T;
}

/**
 * Convert L2 distance to a similarity score (0-1).
 * Lower distance = higher similarity.
 */
function distanceToScore(distance: number): number {
  return 1 / (1 + distance);
}

/**
 * VectorMemory implementation backed by ChromaDB.
 *
 * This adapter wraps a Chroma collection and implements the VectorMemory interface,
 * allowing you to use ChromaDB for RAG workflows with Cria's VectorSearch component.
 *
 * @template T - The type of data stored in the collection
 *
 * @example
 * ```typescript
 * import { ChromaClient } from "chromadb";
 * import { ChromaStore } from "@fastpaca/cria/memory/chroma";
 * import { VectorSearch } from "@fastpaca/cria";
 *
 * const client = new ChromaClient({ path: "http://localhost:8000" });
 * const collection = await client.getOrCreateCollection({ name: "my-docs" });
 *
 * const store = new ChromaStore({
 *   collection,
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
export class ChromaStore<T = unknown> implements VectorMemory<T> {
  private readonly collection: Collection;
  private readonly embed: EmbeddingFunction;

  constructor(options: ChromaStoreOptions) {
    this.collection = options.collection;
    this.embed = options.embed;
  }

  async get(key: string): Promise<MemoryEntry<T> | null> {
    const response = await this.collection.get({
      ids: [key],
      include: [IncludeEnum.Documents, IncludeEnum.Metadatas],
    });

    if (!response.ids.length) {
      return null;
    }

    const document = response.documents?.[0];
    const metadata = response.metadatas?.[0];
    const data = parseDocument<T>(document, metadata);

    return {
      data,
      createdAt: Date.now(), // Chroma doesn't store timestamps by default
      updatedAt: Date.now(),
      ...(metadata && { metadata: metadata as Record<string, unknown> }),
    };
  }

  async set(
    key: string,
    data: T,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    // Convert data to text for embedding and storage
    const document = typeof data === "string" ? data : JSON.stringify(data);
    const vector = await this.embed(document);

    // Convert metadata to Chroma's expected type
    const chromaMetadata = metadata as Metadata | undefined;

    if (chromaMetadata) {
      await this.collection.upsert({
        ids: [key],
        embeddings: [vector],
        documents: [document],
        metadatas: [chromaMetadata],
      });
    } else {
      await this.collection.upsert({
        ids: [key],
        embeddings: [vector],
        documents: [document],
      });
    }
  }

  async delete(key: string): Promise<boolean> {
    await this.collection.delete({ ids: [key] });
    return true; // Chroma doesn't return whether the record existed
  }

  async search(
    query: string,
    options?: VectorSearchOptions
  ): Promise<VectorSearchResult<T>[]> {
    const limit = options?.limit ?? 10;
    const threshold = options?.threshold;

    const queryVector = await this.embed(query);

    const response = await this.collection.query({
      queryEmbeddings: [queryVector],
      nResults: limit,
      include: [
        IncludeEnum.Documents,
        IncludeEnum.Metadatas,
        IncludeEnum.Distances,
      ],
    });

    const ids = response.ids[0] ?? [];
    const documents = response.documents?.[0] ?? [];
    const metadatas = response.metadatas?.[0] ?? [];
    const distances = response.distances?.[0] ?? [];

    return this.buildSearchResults(
      ids,
      documents,
      metadatas,
      distances,
      threshold
    );
  }

  private buildSearchResults(
    ids: (string | undefined)[],
    documents: (string | null | undefined)[],
    metadatas: (Metadata | null | undefined)[],
    distances: (number | null | undefined)[],
    threshold: number | undefined
  ): VectorSearchResult<T>[] {
    const results: VectorSearchResult<T>[] = [];

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (id === undefined) {
        continue;
      }

      const distance = distances[i] ?? 0;
      const score = distanceToScore(distance);

      if (threshold !== undefined && score < threshold) {
        continue;
      }

      const document = documents[i];
      const metadata = metadatas[i];
      const data = parseDocument<T>(document, metadata);

      results.push({
        key: id,
        score,
        entry: {
          data,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ...(metadata && { metadata: metadata as Record<string, unknown> }),
        },
      });
    }

    return results;
  }
}
