export interface SpanRecord {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string | undefined;
  kind?: number | undefined;
  startTimeMs: number;
  endTimeMs: number;
  attributes: Record<string, unknown>;
  resourceAttributes: Record<string, unknown>;
  events: SpanEventRecord[];
}

export interface SpanEventRecord {
  name: string;
  timeMs: number;
  attributes: Record<string, unknown>;
}
