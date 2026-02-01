import { createRequire } from "node:module";
import type { SpanEventRecord, SpanRecord } from "./types.js";

interface OtelRoot {
  opentelemetry: {
    proto: {
      collector: {
        trace: {
          v1: {
            ExportTraceServiceRequest: {
              decode: (buffer: Uint8Array) => OtlpTraceRequest;
            };
          };
        };
      };
    };
  };
}

const require = createRequire(import.meta.url);
const root =
  require("@opentelemetry/otlp-transformer/build/src/generated/root.js") as OtelRoot;

const traceRequestType =
  root.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;

interface AnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: number | string | { toNumber?: () => number };
  doubleValue?: number;
  bytesValue?: Uint8Array | string;
  arrayValue?: { values?: AnyValue[] };
  kvlistValue?: { values?: KeyValue[] };
}

interface KeyValue {
  key?: string;
  value?: AnyValue;
}

interface OtlpSpan {
  name?: string;
  traceId?: Uint8Array | string;
  spanId?: Uint8Array | string;
  parentSpanId?: Uint8Array | string;
  kind?: number;
  startTimeUnixNano?: number | string | { toString?: () => string };
  endTimeUnixNano?: number | string | { toString?: () => string };
  attributes?: KeyValue[];
  events?: OtlpEvent[];
}

interface OtlpEvent {
  name?: string;
  timeUnixNano?: number | string | { toString?: () => string };
  attributes?: KeyValue[];
}

interface OtlpScopeSpan {
  scope?: { name?: string };
  spans?: OtlpSpan[];
}

interface OtlpResourceSpans {
  resource?: { attributes?: KeyValue[] };
  scopeSpans?: OtlpScopeSpan[];
}

interface OtlpTraceRequest {
  resourceSpans?: OtlpResourceSpans[];
}

const toHex = (value: Uint8Array | string | undefined): string => {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return Buffer.from(value).toString("hex");
};

const toNumberValue = (value: AnyValue["intValue"]): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  if (typeof value === "object" && "toNumber" in value && value.toNumber) {
    return value.toNumber();
  }
  return undefined;
};

const toNanoMs = (value: OtlpSpan["startTimeUnixNano"]): number => {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value === "number") {
    return Math.floor(value / 1_000_000);
  }
  if (typeof value === "string") {
    const asBigInt = BigInt(value);
    return Number(asBigInt / 1_000_000n);
  }
  if (typeof value === "object" && "toString" in value && value.toString) {
    const asBigInt = BigInt(value.toString());
    return Number(asBigInt / 1_000_000n);
  }
  return 0;
};

const parseAnyValue = (value?: AnyValue): unknown => {
  if (!value) {
    return undefined;
  }
  if (value.stringValue !== undefined) {
    return value.stringValue;
  }
  if (value.boolValue !== undefined) {
    return value.boolValue;
  }
  if (value.intValue !== undefined) {
    return toNumberValue(value.intValue);
  }
  if (value.doubleValue !== undefined) {
    return value.doubleValue;
  }
  if (value.bytesValue !== undefined) {
    if (typeof value.bytesValue === "string") {
      return value.bytesValue;
    }
    return Buffer.from(value.bytesValue).toString("base64");
  }
  if (value.arrayValue?.values) {
    return value.arrayValue.values.map((entry) => parseAnyValue(entry));
  }
  if (value.kvlistValue?.values) {
    const output: Record<string, unknown> = {};
    for (const entry of value.kvlistValue.values) {
      if (!entry.key) {
        continue;
      }
      output[entry.key] = parseAnyValue(entry.value);
    }
    return output;
  }
  return undefined;
};

const parseAttributes = (
  attributes: KeyValue[] | undefined
): Record<string, unknown> => {
  const output: Record<string, unknown> = {};
  if (!attributes) {
    return output;
  }
  for (const entry of attributes) {
    if (!entry.key) {
      continue;
    }
    output[entry.key] = parseAnyValue(entry.value);
  }
  return output;
};

const parseEvents = (events: OtlpEvent[] | undefined): SpanEventRecord[] => {
  if (!events) {
    return [];
  }
  return events.map((event) => ({
    name: event.name ?? "",
    timeMs: toNanoMs(event.timeUnixNano),
    attributes: parseAttributes(event.attributes),
  }));
};

export const decodeOtlpTraces = (
  buffer: Buffer,
  contentType: string | undefined
): SpanRecord[] => {
  const isJson = contentType?.includes("json");
  const request: OtlpTraceRequest = isJson
    ? (JSON.parse(buffer.toString("utf-8")) as OtlpTraceRequest)
    : (traceRequestType.decode(buffer) as OtlpTraceRequest);

  const spans: SpanRecord[] = [];
  const resourceSpans = request.resourceSpans ?? [];

  for (const resource of resourceSpans) {
    const resourceAttributes = parseAttributes(resource.resource?.attributes);
    for (const scope of resource.scopeSpans ?? []) {
      for (const span of scope.spans ?? []) {
        spans.push({
          name: span.name ?? "",
          traceId: toHex(span.traceId),
          spanId: toHex(span.spanId),
          parentSpanId: span.parentSpanId
            ? toHex(span.parentSpanId)
            : undefined,
          kind: span.kind,
          startTimeMs: toNanoMs(span.startTimeUnixNano),
          endTimeMs: toNanoMs(span.endTimeUnixNano),
          attributes: parseAttributes(span.attributes),
          resourceAttributes,
          events: parseEvents(span.events),
        });
      }
    }
  }

  return spans;
};
