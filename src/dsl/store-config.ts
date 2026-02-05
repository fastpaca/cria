import type { KVMemory, VectorMemory } from "../memory";
import { InMemoryStore } from "../memory";
import type { ChromaStoreOptions } from "../memory/chroma";
import type { PostgresStoreOptions } from "../memory/postgres";
import type { QdrantStoreOptions } from "../memory/qdrant";
import type { RedisStoreOptions } from "../memory/redis";
import type { SqliteStoreOptions } from "../memory/sqlite";
import type { SqliteVectorStoreOptions } from "../memory/sqlite-vector";

export type KVStoreConfig<T> =
  | KVMemory<T>
  | { memory: true }
  | { sqlite: string | SqliteStoreOptions }
  | { redis: RedisStoreOptions }
  | { postgres: PostgresStoreOptions };

export type VectorStoreConfig<T> =
  | VectorMemory<T>
  | { sqlite: SqliteVectorStoreOptions<T> }
  | { qdrant: QdrantStoreOptions }
  | { chroma: ChromaStoreOptions };

class LazyKVStore<T> implements KVMemory<T> {
  private storePromise: Promise<KVMemory<T>> | null = null;
  private readonly loader: () => Promise<KVMemory<T>>;

  constructor(loader: () => Promise<KVMemory<T>>) {
    this.loader = loader;
  }

  private async getStore(): Promise<KVMemory<T>> {
    if (!this.storePromise) {
      this.storePromise = this.loader();
    }
    return await this.storePromise;
  }

  async get(key: string) {
    const store = await this.getStore();
    return await store.get(key);
  }

  async set(key: string, data: T, metadata?: Record<string, unknown>) {
    const store = await this.getStore();
    await store.set(key, data, metadata);
  }

  async delete(key: string) {
    const store = await this.getStore();
    return await store.delete(key);
  }
}

class LazyVectorStore<T> implements VectorMemory<T> {
  private storePromise: Promise<VectorMemory<T>> | null = null;
  private readonly loader: () => Promise<VectorMemory<T>>;

  constructor(loader: () => Promise<VectorMemory<T>>) {
    this.loader = loader;
  }

  private async getStore(): Promise<VectorMemory<T>> {
    if (!this.storePromise) {
      this.storePromise = this.loader();
    }
    return await this.storePromise;
  }

  async get(key: string) {
    const store = await this.getStore();
    return await store.get(key);
  }

  async set(key: string, data: T, metadata?: Record<string, unknown>) {
    const store = await this.getStore();
    await store.set(key, data, metadata);
  }

  async delete(key: string) {
    const store = await this.getStore();
    return await store.delete(key);
  }

  async search(
    query: string,
    options?: Parameters<VectorMemory<T>["search"]>[1]
  ) {
    const store = await this.getStore();
    return await store.search(query, options);
  }
}

const isKVMemory = <T>(value: KVStoreConfig<T>): value is KVMemory<T> => {
  return (
    typeof value === "object" &&
    value !== null &&
    "get" in value &&
    "set" in value &&
    "delete" in value
  );
};

const isVectorMemory = <T>(
  value: VectorStoreConfig<T>
): value is VectorMemory<T> => {
  return (
    typeof value === "object" &&
    value !== null &&
    "search" in value &&
    "get" in value &&
    "set" in value &&
    "delete" in value
  );
};

const normalizeSqliteOptions = (
  value: string | SqliteStoreOptions
): SqliteStoreOptions => {
  return typeof value === "string" ? { filename: value } : value;
};

const loadModule = async <T>(
  loader: () => Promise<T>,
  message: string
): Promise<T> => {
  try {
    return await loader();
  } catch (error) {
    throw new Error(message, { cause: error });
  }
};

export const resolveKVStore = <T>(config: KVStoreConfig<T>): KVMemory<T> => {
  if (isKVMemory(config)) {
    return config;
  }

  if ("memory" in config) {
    if (config.memory !== true) {
      throw new Error("Memory store config must be { memory: true }.");
    }
    return new InMemoryStore<T>();
  }

  if ("sqlite" in config) {
    const options = normalizeSqliteOptions(config.sqlite);
    return new LazyKVStore<T>(async () => {
      const { SqliteStore } = await loadModule(
        () => import("../memory/sqlite"),
        "SQLite store requires @libsql/client. Install it to use { sqlite: ... }."
      );
      return new SqliteStore<T>(options);
    });
  }

  if ("redis" in config) {
    return new LazyKVStore<T>(async () => {
      const { RedisStore } = await loadModule(
        () => import("../memory/redis"),
        "Redis store requires ioredis. Install it to use { redis: ... }."
      );
      return new RedisStore<T>(config.redis);
    });
  }

  if ("postgres" in config) {
    return new LazyKVStore<T>(async () => {
      const { PostgresStore } = await loadModule(
        () => import("../memory/postgres"),
        "Postgres store requires pg. Install it to use { postgres: ... }."
      );
      return new PostgresStore<T>(config.postgres);
    });
  }

  throw new Error("Unsupported KV store configuration.");
};

export const resolveVectorStore = <T>(
  config: VectorStoreConfig<T>
): VectorMemory<T> => {
  if (isVectorMemory(config)) {
    return config;
  }

  if ("sqlite" in config) {
    return new LazyVectorStore<T>(async () => {
      const { SqliteVectorStore } = await loadModule(
        () => import("../memory/sqlite-vector"),
        "SQLite vector store requires @libsql/client. Install it to use { sqlite: ... }."
      );
      return new SqliteVectorStore<T>(config.sqlite);
    });
  }

  if ("qdrant" in config) {
    return new LazyVectorStore<T>(async () => {
      const { QdrantStore } = await loadModule(
        () => import("../memory/qdrant"),
        "Qdrant store requires @qdrant/js-client-rest. Install it to use { qdrant: ... }."
      );
      return new QdrantStore<T>(config.qdrant);
    });
  }

  if ("chroma" in config) {
    return new LazyVectorStore<T>(async () => {
      const { ChromaStore } = await loadModule(
        () => import("../memory/chroma"),
        "Chroma store requires chromadb. Install it to use { chroma: ... }."
      );
      return new ChromaStore<T>(config.chroma);
    });
  }

  throw new Error("Unsupported vector store configuration.");
};
