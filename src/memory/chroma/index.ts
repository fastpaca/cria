import { type Collection, IncludeEnum, type Metadata } from "chromadb";
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
 * Options for creating a ChromaStore.
 */
export interface ChromaStoreOptions<T> {
  /** The Chroma collection to use */
  collection: Collection;
  /** Function to generate embeddings from text */
  embed: EmbeddingFunction;
  /** Schema used to validate stored data at read boundaries. */
  schema: ZodType<T>;
}

/**
 * Parse a document string. Tries JSON.parse first, returns raw string on failure.
 * Throws if document is missing.
 */
function parseDocument<T>(
  document: string | null | undefined,
  schema: ZodType<T>,
  context: string
): T {
  if (!document) {
    throw new Error("ChromaStore: document is missing from entry");
  }

  try {
    const parsed: unknown = JSON.parse(document);
    return schema.parse(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) {
      try {
        return schema.parse(document);
      } catch (schemaError) {
        throw new Error(
          `ChromaStore: stored value failed schema validation during ${context}`,
          { cause: schemaError }
        );
      }
    }
    throw new Error(
      `ChromaStore: stored value failed schema validation during ${context}`,
      { cause: error }
    );
  }
}

/**
 * Convert L2 distance to a similarity score (0-1).
 * Lower distance = higher similarity.
 */
function distanceToScore(distance: number): number {
  return 1 / (1 + distance);
}

/**
 * Extract timestamp from Chroma metadata field.
 */
function extractTimestamp(
  metadata: Metadata | null | undefined,
  field: "_createdAt" | "_updatedAt"
): number {
  const value = metadata?.[field];
  return typeof value === "number" ? value : 0;
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
 * import { z } from "zod";
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
 *   schema: z.string(),
 * });
 *
 * // Use with VectorSearch
 * <VectorSearch store={store} limit={5}>
 *   What is RAG?
 * </VectorSearch>
 * ```
 */
export class ChromaStore<T = unknown> implements VectorMemory<T> {
  private readonly collection: Collection;
  private readonly embedFn: EmbeddingFunction;
  private readonly schema: ZodType<T>;

  constructor(options: ChromaStoreOptions<T>) {
    this.collection = options.collection;
    this.embedFn = options.embed;
    this.schema = options.schema;
  }

  private async embed(text: string, context: string): Promise<number[]> {
    try {
      return await this.embedFn(text);
    } catch (error) {
      throw new Error(`ChromaStore: embedding failed during ${context}`, {
        cause: error,
      });
    }
  }

  async get(key: string): Promise<MemoryEntry<T> | null> {
    const response = await this.collection.get({
      ids: [key],
      include: [IncludeEnum.documents, IncludeEnum.metadatas],
    });

    if (!response.ids.length) {
      return null;
    }

    const document = response.documents?.[0];
    const metadata = response.metadatas?.[0];

    return {
      data: parseDocument<T>(document, this.schema, `get("${key}")`),
      createdAt: extractTimestamp(metadata, "_createdAt"),
      updatedAt: extractTimestamp(metadata, "_updatedAt"),
      ...(metadata && { metadata }),
    };
  }

  async set(
    key: string,
    data: T,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const now = Date.now();

    // Check if entry exists to preserve createdAt
    const existing = await this.get(key);
    const createdAt = existing?.createdAt ?? now;

    // Convert data to text for embedding and storage
    const document = typeof data === "string" ? data : JSON.stringify(data);
    const vector = await this.embed(document, `set("${key}")`);

    // Merge user metadata with timestamps
    const chromaMetadata: Metadata = {
      ...metadata,
      _createdAt: createdAt,
      _updatedAt: now,
    };

    await this.collection.upsert({
      ids: [key],
      embeddings: [vector],
      documents: [document],
      metadatas: [chromaMetadata],
    });
  }

  async delete(key: string): Promise<boolean> {
    const existing = await this.get(key);
    if (!existing) {
      return false;
    }
    await this.collection.delete({ ids: [key] });
    return true;
  }

  async search(
    query: string,
    options?: VectorSearchOptions
  ): Promise<VectorSearchResult<T>[]> {
    const limit = options?.limit ?? 10;
    const threshold = options?.threshold;

    const queryVector = await this.embed(query, "search");

    const response = await this.collection.query({
      queryEmbeddings: [queryVector],
      nResults: limit,
      include: [
        IncludeEnum.documents,
        IncludeEnum.metadatas,
        IncludeEnum.distances,
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

      const metadata = metadatas[i];

      results.push({
        key: id,
        score,
        entry: {
          data: parseDocument<T>(documents[i], this.schema, `search("${id}")`),
          createdAt: extractTimestamp(metadata, "_createdAt"),
          updatedAt: extractTimestamp(metadata, "_updatedAt"),
          ...(metadata && { metadata }),
        },
      });
    }

    return results;
  }
}
