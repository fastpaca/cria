export type DevtoolsStatus = "success" | "error";

export interface DevtoolsErrorPayload {
  message: string;
  overBudgetBy?: number | undefined;
  priority?: number | undefined;
  iteration?: number | undefined;
}

export interface DevtoolsToolCallPayload {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface DevtoolsToolResultPayload {
  toolCallId: string;
  toolName: string;
  output: unknown;
}

export interface DevtoolsMessageSnapshot {
  phase: "before" | "after";
  index: number;
  role: string;
  id?: string | undefined;
  scopePath: string;
  text?: string | undefined;
  reasoning?: string | undefined;
  toolCalls?: readonly DevtoolsToolCallPayload[] | undefined;
  toolResults?: readonly DevtoolsToolResultPayload[] | undefined;
}

export interface DevtoolsStrategyEvent {
  iteration: number;
  priority: number;
  result: "node" | "null";
  targetScope: {
    id?: string | undefined;
    priority: number;
    childCount: number;
    messageCount: number;
    scopeCount: number;
    hasStrategy: boolean;
  };
}

export interface DevtoolsTimingEvent {
  name: string;
  startOffsetMs: number;
  endOffsetMs: number;
  attributes?: Record<string, string | number | boolean> | undefined;
}

export interface DevtoolsSessionPayload {
  id: string;
  startedAt: string;
  durationMs: number;
  budget?: number | undefined;
  totalTokensBefore?: number | undefined;
  totalTokensAfter?: number | undefined;
  iterations?: number | undefined;
  status: DevtoolsStatus;
  error?: DevtoolsErrorPayload | undefined;
  snapshots: {
    before: DevtoolsMessageSnapshot[];
    after: DevtoolsMessageSnapshot[];
  };
  strategyEvents: DevtoolsStrategyEvent[];
  timing: DevtoolsTimingEvent[];
  trace?:
    | {
        traceId: string;
        parentSpanId?: string | undefined;
      }
    | undefined;
  initiator?:
    | {
        name?: string | undefined;
        kind?: string | undefined;
        serviceName?: string | undefined;
        route?: string | undefined;
      }
    | undefined;
  source?:
    | {
        pid?: number | undefined;
        serviceName?: string | undefined;
        serviceInstanceId?: string | undefined;
      }
    | undefined;
  label?: string | undefined;
}

export interface DevtoolsSessionStoreSnapshot {
  sessions: DevtoolsSessionPayload[];
  updatedAt: string;
}
