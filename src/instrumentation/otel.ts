import {
  type Attributes,
  type Context,
  context,
  type Span,
  SpanStatusCode,
  type Tracer,
} from "@opentelemetry/api";
import type { RenderHooks } from "../render";
import type { PromptNode, PromptScope } from "../types";

interface OtelRenderHooksOptions {
  tracer: Tracer;
  /** Root span name for a render fit. Default: "cria.fit". */
  spanName?: string;
  /** Static attributes applied to all spans. */
  attributes?: Attributes;
  /** Emit per-message prompt structure spans at fit start. */
  emitPromptStructure?: boolean;
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
  emitPromptStructure = false,
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

      if (emitPromptStructure) {
        emitPromptStructureSpans(
          tracer,
          context.active(),
          `${spanName}.prompt.message`,
          attributes,
          event.element
        );
      }
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
      const span =
        fitSpan ?? tracer.startSpan(spanName, undefined, context.active());
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

function setElementAttributes(span: Span, element: PromptNode): void {
  span.setAttribute("cria.node.kind", element.kind);

  if (element.id) {
    span.setAttribute("cria.node.id", element.id);
  }

  if (element.kind === "scope") {
    span.setAttribute("cria.node.priority", element.priority);

    span.setAttribute("cria.scope.priority", element.priority);
    setOptionalAttribute(span, "cria.scope.id", element.id);

    const stats = countScopeStats(element);
    span.setAttribute("cria.scope.child_count", element.children.length);
    span.setAttribute("cria.scope.message_count", stats.messageCount);
    span.setAttribute("cria.scope.scope_count", stats.scopeCount);
    span.setAttribute("cria.scope.has_strategy", Boolean(element.strategy));

    return;
  }

  span.setAttribute("cria.node.role", element.role);
  span.setAttribute("cria.message.role", element.role);
  setOptionalAttribute(span, "cria.message.id", element.id);
}

function countScopeStats(scope: PromptScope): {
  messageCount: number;
  scopeCount: number;
} {
  return scope.children.reduce(
    (acc, child) => {
      if (child.kind === "message") {
        acc.messageCount += 1;
        return acc;
      }

      acc.scopeCount += 1;
      const nested = countScopeStats(child);
      acc.messageCount += nested.messageCount;
      acc.scopeCount += nested.scopeCount;
      return acc;
    },
    { messageCount: 0, scopeCount: 0 }
  );
}

function emitPromptStructureSpans(
  tracer: Tracer,
  activeContext: Context,
  spanName: string,
  baseAttributes: Attributes,
  root: PromptScope
): void {
  let index = 0;

  const walkMessages = (scope: PromptScope, path: readonly string[]): void => {
    const nextPath = [...path, formatScopeSegment(scope)];

    for (const child of scope.children) {
      if (child.kind === "message") {
        const span = tracer.startSpan(spanName, undefined, activeContext);
        setAttributes(span, {
          ...baseAttributes,
          "cria.message.index": index,
          "cria.message.role": child.role,
          "cria.message.scope_path": nextPath.join("/"),
        });
        setOptionalAttribute(span, "cria.message.id", child.id);
        span.end();
        index += 1;
        continue;
      }

      walkMessages(child, nextPath);
    }
  };

  walkMessages(root, []);
}

function formatScopeSegment(scope: PromptScope): string {
  return scope.id ? `p${scope.priority}:${scope.id}` : `p${scope.priority}`;
}

function setOptionalAttribute(span: Span, key: string, value: unknown): void {
  if (value === undefined) {
    return;
  }
  span.setAttribute(key, value as never);
}

function setAttributes(span: Span, attrs: Attributes): void {
  for (const [key, value] of Object.entries(attrs)) {
    setOptionalAttribute(span, key, value);
  }
}
