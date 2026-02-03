import type {
  DevtoolsErrorPayload,
  DevtoolsMessageSnapshot,
  DevtoolsSessionPayload,
  DevtoolsStrategyEvent,
  DevtoolsTimingEvent,
  DevtoolsToolCallPayload,
  DevtoolsToolResultPayload,
} from "../shared/types.js";
import type { SpanRecord } from "./types.js";

const SESSION_SPAN = "cria.fit";
const ITERATION_SPAN = "cria.fit.iteration";
const STRATEGY_SPAN = "cria.fit.strategy";
const MESSAGE_SPAN = "cria.fit.prompt.message";

const BUDGET_ERROR_REGEX =
  /exceeds budget (\d+) by (\d+) at priority (-?\d+) \(iteration (\d+)\)/i;

const SPAN_KIND_LABELS: Record<number, string> = {
  2: "server",
  3: "client",
  4: "producer",
  5: "consumer",
};

const getKindLabel = (kind: number | undefined): string =>
  (kind && SPAN_KIND_LABELS[kind]) || "internal";

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const readAttribute = (attrs: Record<string, unknown>, key: string): unknown =>
  attrs[key];

const parseToolJson = (value: unknown): unknown[] | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const isToolCallPayload = (
  value: unknown
): value is DevtoolsToolCallPayload => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as { toolCallId?: unknown; toolName?: unknown };
  return (
    typeof record.toolCallId === "string" && typeof record.toolName === "string"
  );
};

const isToolResultPayload = (
  value: unknown
): value is DevtoolsToolResultPayload => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as { toolCallId?: unknown; toolName?: unknown };
  return (
    typeof record.toolCallId === "string" && typeof record.toolName === "string"
  );
};

const parseToolCalls = (
  value: unknown
): DevtoolsToolCallPayload[] | undefined => {
  const parsed = parseToolJson(value);
  if (!parsed) {
    return undefined;
  }
  const calls = parsed.filter(isToolCallPayload);
  return calls.length > 0 ? calls : undefined;
};

const parseToolResults = (
  value: unknown
): DevtoolsToolResultPayload[] | undefined => {
  const parsed = parseToolJson(value);
  if (!parsed) {
    return undefined;
  }
  const results = parsed.filter(isToolResultPayload);
  return results.length > 0 ? results : undefined;
};

const parseMessageSnapshot = (
  span: SpanRecord
): DevtoolsMessageSnapshot | undefined => {
  const attrs = span.attributes;
  const phase = asString(readAttribute(attrs, "cria.prompt.phase"));
  if (phase !== "before" && phase !== "after") {
    return undefined;
  }
  const index = asNumber(readAttribute(attrs, "cria.message.index"));
  const role = asString(readAttribute(attrs, "cria.message.role"));
  const scopePath = asString(readAttribute(attrs, "cria.message.scope_path"));
  if (index === undefined || !role || !scopePath) {
    return undefined;
  }

  const snapshot: DevtoolsMessageSnapshot = {
    phase,
    index,
    role,
    scopePath,
  };

  const id = asString(readAttribute(attrs, "cria.message.id"));
  if (id) {
    snapshot.id = id;
  }

  const text = asString(readAttribute(attrs, "cria.message.text"));
  if (text) {
    snapshot.text = text;
  }

  const reasoning = asString(readAttribute(attrs, "cria.message.reasoning"));
  if (reasoning) {
    snapshot.reasoning = reasoning;
  }

  const toolCalls = parseToolCalls(
    readAttribute(attrs, "cria.message.tool_calls")
  );
  if (toolCalls) {
    snapshot.toolCalls = toolCalls;
  }

  const toolResults = parseToolResults(
    readAttribute(attrs, "cria.message.tool_results")
  );
  if (toolResults) {
    snapshot.toolResults = toolResults;
  }

  return snapshot;
};

const parseStrategyEvent = (
  span: SpanRecord
): DevtoolsStrategyEvent | undefined => {
  const attrs = span.attributes;
  const iteration = asNumber(readAttribute(attrs, "cria.iteration"));
  const priority = asNumber(readAttribute(attrs, "cria.priority"));
  if (iteration === undefined || priority === undefined) {
    return undefined;
  }

  const result =
    asString(readAttribute(attrs, "cria.strategy.result")) ?? "null";
  const targetScope = {
    id: asString(readAttribute(attrs, "cria.scope.id")),
    priority: asNumber(readAttribute(attrs, "cria.scope.priority")) ?? priority,
    childCount: asNumber(readAttribute(attrs, "cria.scope.child_count")) ?? 0,
    messageCount:
      asNumber(readAttribute(attrs, "cria.scope.message_count")) ?? 0,
    scopeCount: asNumber(readAttribute(attrs, "cria.scope.scope_count")) ?? 0,
    hasStrategy: Boolean(readAttribute(attrs, "cria.scope.has_strategy")),
  };

  return {
    iteration,
    priority,
    result: result === "node" ? "node" : "null",
    targetScope,
  };
};

const extractError = (span: SpanRecord): DevtoolsErrorPayload | undefined => {
  const exception = span.events.find((event) => event.name === "exception");
  const message =
    asString(exception?.attributes?.["exception.message"]) ??
    asString(span.attributes["error.message"]);
  if (!message) {
    return undefined;
  }

  const match = BUDGET_ERROR_REGEX.exec(message);

  return {
    message,
    overBudgetBy: match ? Number(match[2]) : undefined,
    priority: match
      ? Number(match[3])
      : asNumber(span.attributes["cria.priority"]),
    iteration: match
      ? Number(match[4])
      : asNumber(span.attributes["cria.iteration"]),
  };
};

const deriveInitiator = (fitSpan: SpanRecord, traceSpans: SpanRecord[]) => {
  if (!fitSpan.parentSpanId) {
    return undefined;
  }
  const parent = traceSpans.find(
    (span) => span.spanId === fitSpan.parentSpanId
  );
  if (!parent) {
    return undefined;
  }
  const kindLabel = getKindLabel(parent.kind);

  const route =
    asString(parent.attributes["http.route"]) ??
    asString(parent.attributes["rpc.method"]) ??
    asString(parent.attributes["graphql.operation.name"]);

  const serviceName = asString(parent.resourceAttributes["service.name"]);

  return {
    name: parent.name,
    kind: kindLabel,
    serviceName,
    route,
  };
};

const buildTiming = (
  fitSpan: SpanRecord,
  traceSpans: SpanRecord[],
  snapshots: {
    before: DevtoolsMessageSnapshot[];
    after: DevtoolsMessageSnapshot[];
  }
): DevtoolsTimingEvent[] => {
  const startMs = fitSpan.startTimeMs;
  const timing: DevtoolsTimingEvent[] = [];

  const pushSpan = (span: SpanRecord, name: string): void => {
    timing.push({
      name,
      startOffsetMs: span.startTimeMs - startMs,
      endOffsetMs: span.endTimeMs - startMs,
    });
  };

  pushSpan(fitSpan, SESSION_SPAN);

  for (const span of traceSpans) {
    if (span.name === ITERATION_SPAN) {
      pushSpan(span, ITERATION_SPAN);
    }
    if (span.name === STRATEGY_SPAN) {
      pushSpan(span, STRATEGY_SPAN);
    }
  }

  const phaseMarkers = (phase: "before" | "after") => {
    const phaseSpans = traceSpans.filter(
      (span) =>
        span.name === MESSAGE_SPAN &&
        span.attributes["cria.prompt.phase"] === phase
    );
    if (phaseSpans.length === 0) {
      return;
    }
    const start = Math.min(...phaseSpans.map((span) => span.startTimeMs));
    const end = Math.max(...phaseSpans.map((span) => span.endTimeMs));
    timing.push({
      name: `cria.prompt.${phase}`,
      startOffsetMs: start - startMs,
      endOffsetMs: end - startMs,
    });
  };

  if (snapshots.before.length > 0) {
    phaseMarkers("before");
  }
  if (snapshots.after.length > 0) {
    phaseMarkers("after");
  }

  return timing;
};

export const buildSessions = (
  traceSpans: SpanRecord[]
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Complex trace parsing
): DevtoolsSessionPayload[] => {
  const sessions: DevtoolsSessionPayload[] = [];
  const fitSpans = traceSpans.filter((span) => span.name === SESSION_SPAN);

  for (const fitSpan of fitSpans) {
    if (!(fitSpan.traceId && fitSpan.spanId)) {
      continue;
    }
    const inWindow = traceSpans.filter(
      (span) =>
        span.startTimeMs >= fitSpan.startTimeMs &&
        span.endTimeMs <= fitSpan.endTimeMs
    );

    const snapshots: {
      before: DevtoolsMessageSnapshot[];
      after: DevtoolsMessageSnapshot[];
    } = {
      before: [],
      after: [],
    };
    const strategies: DevtoolsStrategyEvent[] = [];
    const iterations = new Set<number>();
    const iterationTokens: number[] = [];

    for (const span of inWindow) {
      if (span.name === MESSAGE_SPAN) {
        const snapshot = parseMessageSnapshot(span);
        if (snapshot) {
          if (snapshot.phase === "before") {
            snapshots.before.push(snapshot);
          } else {
            snapshots.after.push(snapshot);
          }
        }
        continue;
      }
      if (span.name === STRATEGY_SPAN) {
        const strategy = parseStrategyEvent(span);
        if (strategy) {
          strategies.push(strategy);
        }
        continue;
      }
      if (span.name === ITERATION_SPAN) {
        const iteration = asNumber(span.attributes["cria.iteration"]);
        if (iteration !== undefined) {
          iterations.add(iteration);
        }
        const tokenCount = asNumber(span.attributes["cria.total_tokens"]);
        if (tokenCount !== undefined) {
          iterationTokens.push(tokenCount);
        }
      }
    }

    snapshots.before.sort((a, b) => a.index - b.index);
    snapshots.after.sort((a, b) => a.index - b.index);

    const budget = asNumber(fitSpan.attributes["cria.budget"]);
    const totalTokensAfter = asNumber(fitSpan.attributes["cria.total_tokens"]);
    const totalTokensBefore =
      iterationTokens.length > 0 ? iterationTokens[0] : totalTokensAfter;

    const error = extractError(fitSpan);
    const status = error ? "error" : "success";

    const timing = buildTiming(fitSpan, inWindow, snapshots);
    const label = asString(fitSpan.attributes["cria.prompt.name"]);
    const source = {
      pid: asNumber(fitSpan.resourceAttributes["process.pid"]),
      serviceName: asString(fitSpan.resourceAttributes["service.name"]),
      serviceInstanceId: asString(
        fitSpan.resourceAttributes["service.instance.id"]
      ),
    };

    const session: DevtoolsSessionPayload = {
      id: `${fitSpan.traceId}-${fitSpan.spanId}`,
      startedAt: new Date(fitSpan.startTimeMs).toISOString(),
      durationMs: Math.max(0, fitSpan.endTimeMs - fitSpan.startTimeMs),
      budget,
      totalTokensBefore,
      totalTokensAfter,
      iterations:
        asNumber(fitSpan.attributes["cria.iterations"]) ?? iterations.size,
      status,
      error,
      snapshots,
      strategyEvents: strategies,
      timing,
      trace: {
        traceId: fitSpan.traceId,
        parentSpanId: fitSpan.parentSpanId,
      },
      initiator: deriveInitiator(fitSpan, traceSpans),
      source,
      label,
    };

    sessions.push(session);
  }

  return sessions;
};
