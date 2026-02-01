import type { RedisOptions } from "ioredis";
import Redis from "ioredis";
import type { KVMemory, MemoryEntry } from "./key-value";

/**
 * Configuration options for the Redis store.
 */
export interface RedisStoreOptions extends RedisOptions {
  /**
   * Key prefix for all entries stored by this instance.
   * Useful for namespacing multiple stores in the same Redis instance.
   * @default "cria:kv:"
   */
  keyPrefix?: string;

  /**
   * TTL (time-to-live) in seconds for entries.
   * If set, entries will automatically expire after this duration.
   * @default undefined (no expiration)
   */
  ttlSeconds?: number;
}

/**
 * Internal structure for storing entries in Redis.
 * Stored as JSON string.
 */
interface StoredEntry<T> {
  data: T;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

const parseStoredEntry = <T>(raw: string, key: string): StoredEntry<T> => {
  try {
    return JSON.parse(raw) as StoredEntry<T>;
  } catch (error) {
    throw new Error(
      `RedisStore: invalid JSON stored for key "${key}": ${String(error)}`
    );
  }
};

/**
 * Redis-backed implementation of KVMemory.
 *
 * Plug-and-play adapter using ioredis. Just pass your connection options.
 *
 * @template T - The type of data to store
 *
 * @example
 * ```typescript
 * import { RedisStore } from "@fastpaca/cria/memory/redis";
 *
 * // Connect to localhost:6379
 * const store = new RedisStore<{ content: string }>();
 *
 * // Connect with options
 * const store = new RedisStore<{ content: string }>({
 *   host: "redis.example.com",
 *   port: 6379,
 *   password: "secret",
 * });
 *
 * await store.set("key-1", { content: "Hello" });
 * const entry = await store.get("key-1");
 * ```
 *
 * @example
 * ```typescript
 * // With TTL and custom prefix
 * const store = new RedisStore<string>({
 *   keyPrefix: "myapp:memory:",
 *   ttlSeconds: 3600, // 1 hour TTL
 * });
 * ```
 */
export class RedisStore<T = unknown> implements KVMemory<T> {
  private readonly client: Redis;
  private readonly prefix: string;
  private readonly ttlSeconds?: number;

  constructor(options: RedisStoreOptions = {}) {
    const { keyPrefix, ttlSeconds, ...redisOptions } = options;

    this.client = new Redis(redisOptions);
    this.prefix = keyPrefix ?? "cria:kv:";

    if (ttlSeconds !== undefined) {
      this.ttlSeconds = ttlSeconds;
    }
  }

  private prefixedKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  async get(key: string): Promise<MemoryEntry<T> | null> {
    const prefixedKey = this.prefixedKey(key);
    const raw = await this.client.get(prefixedKey);

    if (raw === null) {
      return null;
    }

    const stored = parseStoredEntry<T>(raw, prefixedKey);

    return {
      data: stored.data,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      ...(stored.metadata && { metadata: stored.metadata }),
    };
  }

  async set(
    key: string,
    data: T,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const prefixedKey = this.prefixedKey(key);
    const now = Date.now();

    // Try to get existing entry to preserve createdAt
    const existingRaw = await this.client.get(prefixedKey);
    let createdAt = now;

    if (existingRaw !== null) {
      const existing = parseStoredEntry<T>(existingRaw, prefixedKey);
      createdAt = existing.createdAt;
    }

    const entry: StoredEntry<T> = {
      data,
      createdAt,
      updatedAt: now,
      ...(metadata && { metadata }),
    };

    const value = JSON.stringify(entry);

    if (this.ttlSeconds !== undefined) {
      await this.client.set(prefixedKey, value, "EX", this.ttlSeconds);
    } else {
      await this.client.set(prefixedKey, value);
    }
  }

  async delete(key: string): Promise<boolean> {
    const count = await this.client.del(this.prefixedKey(key));
    return count > 0;
  }

  /**
   * Disconnect from Redis.
   * Call this when you're done using the store to clean up connections.
   */
  async disconnect(): Promise<void> {
    await this.client.quit();
  }
}

// Re-export types for convenience
export type { KVMemory, MemoryEntry } from "./key-value";
