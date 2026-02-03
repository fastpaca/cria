import type { RedisOptions } from "ioredis";
import Redis from "ioredis";
import { z } from "zod";
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

const StoredEntrySchema = z
  .preprocess(
    (value) => {
      if (typeof value === "string") {
        return JSON.parse(value);
      }

      return value;
    },
    z.object({
      data: z.unknown(),
      createdAt: z.number(),
      updatedAt: z.number(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
  )
  .transform((entry) => ({
    data: entry.data,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    ...(entry.metadata && { metadata: entry.metadata }),
  }));

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

    return StoredEntrySchema.parse(raw) as MemoryEntry<T>;
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
      const existing = StoredEntrySchema.parse(existingRaw) as MemoryEntry<T>;
      createdAt = existing.createdAt;
    }

    const entry = {
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
