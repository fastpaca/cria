import { type Collection, IncludeEnum, type Metadata } from "chromadb";
import { z } from "zod";
import type { MemoryEntry } from "../key-value";
import type {
  VectorSearchOptions,
  VectorSearchResult,
  VectorStore,
} from "../vector-store";

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

const DocumentSchema = z
  .preprocess((value) => {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("ChromaStore: document is missing from entry");
    }

    return value;
  }, z.string())
  .transform((document) => {
    try {
      return JSON.parse(document);
    } catch {
      // Document was stored as a raw string (T is string)
      return document;
    }
  });

const MetadataSchema = z.record(z.string(), z.unknown()).optional().nullable();

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
  metadata: Record<string, unknown> | null | undefined,
  field: "_createdAt" | "_updatedAt"
): number {
  const value = metadata?.[field];
  return typeof value === "number" ? value : 0;
}

const ChromaEntrySchema = z
  .object({
    document: DocumentSchema,
    metadata: MetadataSchema,
  })
  .transform((entry) => {
    const metadata = entry.metadata ?? undefined;

    return {
      data: entry.document,
      createdAt: extractTimestamp(metadata, "_createdAt"),
      updatedAt: extractTimestamp(metadata, "_updatedAt"),
      ...(metadata && { metadata }),
    };
  });

/**
 * VectorStore implementation backed by ChromaDB.
 *
 * This adapter wraps a Chroma collection and implements the VectorStore interface,
 * allowing you to use ChromaDB for RAG workflows with Cria's vectordb helper.
 *
 * @template T - The type of data stored in the collection
 *
 * @example
 * ```typescript
 * import { ChromaClient } from "chromadb";
 * import { ChromaStore } from "@fastpaca/cria/memory/chroma";
 * import { cria } from "@fastpaca/cria";
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
 * const vectors = cria.vectordb(store);
 * const retrieval = vectors.plugin({ query: "What is RAG?", limit: 5 });
 *
 * cria.prompt().use(retrieval);
 * ```
 */
export class ChromaStore<T = unknown> implements VectorStore<T> {
  private readonly collection: Collection;
  private readonly embedFn: EmbeddingFunction;

  constructor(options: ChromaStoreOptions) {
    this.collection = options.collection;
    this.embedFn = options.embed;
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

    return ChromaEntrySchema.parse({ document, metadata }) as MemoryEntry<T>;
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
    const vector = await this.embedFn(document);

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
    const filter = options?.filter;
    const where =
      filter === undefined || Object.keys(filter).length === 0
        ? undefined
        : filter;

    const queryVector = await this.embedFn(query);

    const response = await this.collection.query({
      queryEmbeddings: [queryVector],
      nResults: limit,
      include: [
        IncludeEnum.documents,
        IncludeEnum.metadatas,
        IncludeEnum.distances,
      ],
      ...(where !== undefined && { where }),
    });

    const ids = response.ids[0] ?? [];
    const documents = response.documents?.[0] ?? [];
    const metadatas = response.metadatas?.[0] ?? [];
    const distances = response.distances?.[0] ?? [];

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
        entry: ChromaEntrySchema.parse({
          document: documents[i],
          metadata,
        }) as MemoryEntry<T>,
      });
    }

    return results;
  }
}
