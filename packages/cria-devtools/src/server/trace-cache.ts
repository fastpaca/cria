import type { SpanRecord } from "./types.js";

export interface TraceCacheOptions {
  ttlMs: number;
}

interface TraceEntry {
  spans: Map<string, SpanRecord>;
  updatedAt: number;
}

export class TraceCache {
  private readonly ttlMs: number;
  private readonly entries = new Map<string, TraceEntry>();

  constructor(options: TraceCacheOptions) {
    this.ttlMs = options.ttlMs;
  }

  add(spans: SpanRecord[]): void {
    const now = Date.now();
    for (const span of spans) {
      const entry = this.entries.get(span.traceId) ?? {
        spans: new Map<string, SpanRecord>(),
        updatedAt: now,
      };
      entry.spans.set(span.spanId, span);
      entry.updatedAt = now;
      this.entries.set(span.traceId, entry);
    }
  }

  list(traceId: string): SpanRecord[] {
    const entry = this.entries.get(traceId);
    if (!entry) {
      return [];
    }
    return Array.from(entry.spans.values());
  }

  traceIds(): string[] {
    return Array.from(this.entries.keys());
  }

  prune(): void {
    const now = Date.now();
    for (const [traceId, entry] of this.entries) {
      if (now - entry.updatedAt > this.ttlMs) {
        this.entries.delete(traceId);
      }
    }
  }
}
