import { SpanStatusCode, context, type Attributes, type Span, type Tracer } from "@opentelemetry/api";
import type { RenderHooks } from "../render";
import type { PromptElement } from "../types";

interface OtelRenderHooksOptions {
  tracer: Tracer;
  /** Root span name for a render fit. Default: "cria.fit". */
  spanName?: string;
  /** Static attributes applied to all spans. */
  attributes?: Attributes;
}

/**
 * Creates RenderHooks that emit OpenTelemetry spans for fit lifecycle events.
 *
 * - Throws if tracer operations throw.
 * - Uses the provided tracer; does not create global tracers.
 * - Uses explicit ids when present for stable node attribution.
 */
export function createOtelRenderHooks({
  tracer,
  spanName = "cria.fit",
  attributes = {},
}: OtelRenderHooksOptions): RenderHooks {
  let fitSpan: Span | null = null;

  const startChildSpan = (name: string, attrs: Attributes): Span => {
    const span = tracer.startSpan(name, undefined, context.active());
    if (fitSpan) {
      span.setAttribute("cria.fit.trace_id", fitSpan.spanContext().traceId);
    }
    setAttributes(span, { ...attributes, ...attrs });
    return span;
  };

  return {
    onFitStart: (event) => {
      fitSpan = tracer.startSpan(spanName, undefined, context.active());
      setAttributes(fitSpan, {
        ...attributes,
        "cria.budget": event.budget,
        "cria.total_tokens": event.totalTokens,
      });
      setElementAttributes(fitSpan, event.element);
    },

    onFitIteration: (event) => {
      const span = startChildSpan(`${spanName}.iteration`, {
        "cria.iteration": event.iteration,
        "cria.priority": event.priority,
        "cria.total_tokens": event.totalTokens,
      });
      span.end();
    },

    onStrategyApplied: (event) => {
      const span = startChildSpan(`${spanName}.strategy`, {
        "cria.iteration": event.iteration,
        "cria.priority": event.priority,
        "cria.strategy.result": event.result ? "node" : "null",
      });
      setElementAttributes(span, event.target);
      span.end();
    },

    onFitComplete: (event) => {
      if (!fitSpan) {
        return;
      }
      setAttributes(fitSpan, {
        "cria.iterations": event.iterations,
        "cria.total_tokens": event.totalTokens,
      });
      fitSpan.end();
      fitSpan = null;
    },

    onFitError: (event) => {
      const span = fitSpan ?? tracer.startSpan(spanName, undefined, context.active());
      setAttributes(span, {
        ...attributes,
        "cria.iteration": event.iteration,
        "cria.priority": event.priority,
        "cria.total_tokens": event.totalTokens,
      });
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: event.error.message,
      });
      span.recordException(event.error);
      span.end();
      fitSpan = null;
    },
  };
}

function setElementAttributes(span: Span, element: PromptElement): void {
  setAttributes(span, {
    "cria.node.kind": element.kind ?? "region",
    "cria.node.priority": element.priority,
    ...(element.id ? { "cria.node.id": element.id } : {}),
    ...(element.kind === "message" ? { "cria.node.role": element.role } : {}),
    ...(element.kind === "tool-call"
      ? {
          "cria.node.tool_call_id": element.toolCallId,
          "cria.node.tool_name": element.toolName,
        }
      : {}),
    ...(element.kind === "tool-result"
      ? {
          "cria.node.tool_call_id": element.toolCallId,
          "cria.node.tool_name": element.toolName,
        }
      : {}),
  });
}

function setAttributes(span: Span, attrs: Attributes): void {
  for (const [key, value] of Object.entries(attrs)) {
    span.setAttribute(key, value);
  }
}
