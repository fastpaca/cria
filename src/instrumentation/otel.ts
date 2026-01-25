import {
  type Attributes,
  type Context,
  context,
  type Span,
  SpanStatusCode,
  type Tracer,
} from "@opentelemetry/api";
import type { RenderHooks } from "../render";
import type { PromptNode, PromptPart, PromptScope } from "../types";

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

      emitPromptStructureSpans(
        tracer,
        context.active(),
        `${spanName}.prompt.message`,
        attributes,
        event.element,
        "before"
      );
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
      if (event.result) {
        emitPromptStructureSpans(
          tracer,
          context.active(),
          `${spanName}.prompt.message`,
          attributes,
          event.result,
          "after"
        );
      }
      fitSpan.end();
      fitSpan = null;
    },

    onFitError: (event) => {
      if (!fitSpan) {
        fitSpan = tracer.startSpan(spanName, undefined, context.active());
        setAttributes(fitSpan, {
          ...attributes,
          "cria.budget": event.error.budget,
          "cria.total_tokens": event.totalTokens,
        });
      }

      setAttributes(fitSpan, {
        ...attributes,
        "cria.iteration": event.iteration,
        "cria.priority": event.priority,
        "cria.total_tokens": event.totalTokens,
      });
      fitSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: event.error.message,
      });
      fitSpan.recordException(event.error);
      fitSpan.end();
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
  root: PromptScope,
  phase: "before" | "after"
): void {
  let index = 0;

  const walkMessages = (scope: PromptScope, path: readonly string[]): void => {
    const nextPath = [...path, formatScopeSegment(scope)];

    for (const child of scope.children) {
      if (child.kind === "message") {
        const span = tracer.startSpan(spanName, undefined, activeContext);
        setAttributes(span, {
          ...baseAttributes,
          "cria.prompt.phase": phase,
          "cria.message.index": index,
          "cria.message.role": child.role,
          "cria.message.scope_path": nextPath.join("/"),
          ...renderMessageParts(child.children),
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

function renderMessageParts(
  parts: readonly PromptPart[]
): Record<string, string | number | boolean> {
  let text = "";
  let reasoning = "";
  const toolCalls: unknown[] = [];
  const toolResults: unknown[] = [];

  for (const part of parts) {
    if (part.type === "text") {
      text += part.text;
      continue;
    }

    if (part.type === "reasoning") {
      reasoning += part.text;
      continue;
    }

    if (part.type === "tool-call") {
      toolCalls.push({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      });
      continue;
    }

    toolResults.push({
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      output: part.output,
    });
  }

  const attrs: Record<string, string | number | boolean> = {};
  if (text) {
    attrs["cria.message.text"] = text;
  }
  if (reasoning) {
    attrs["cria.message.reasoning"] = reasoning;
  }
  if (toolCalls.length > 0) {
    attrs["cria.message.tool_calls"] = safeStringify(toolCalls);
  }
  if (toolResults.length > 0) {
    attrs["cria.message.tool_results"] = safeStringify(toolResults);
  }

  return attrs;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
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
