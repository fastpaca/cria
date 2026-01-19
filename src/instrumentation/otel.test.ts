import type { Attributes, Span, Tracer } from "@opentelemetry/api";
import { describe, expect, test } from "vitest";
import { render } from "../index";
import { createTestProvider } from "../testing/plaintext";
import type {
  PromptMessageNode,
  PromptPart,
  PromptScope,
  Strategy,
} from "../types";
import { createOtelRenderHooks } from "./otel";

class StubSpan implements Span {
  name: string;
  attributes: Record<string, unknown> = {};
  ended = false;
  status: { code: number; message?: string } | null = null;
  exceptions: unknown[] = [];

  constructor(name: string) {
    this.name = name;
  }

  spanContext(): ReturnType<Span["spanContext"]> {
    return { traceId: "trace", spanId: "span", traceFlags: 1 };
  }
  setAttribute(key: string, value: unknown): this {
    this.attributes[key] = value;
    return this;
  }
  setAttributes(attrs: Attributes): this {
    Object.assign(this.attributes, attrs);
    return this;
  }
  addEvent(): this {
    return this;
  }
  addLink(): this {
    return this;
  }
  addLinks(): this {
    return this;
  }
  setStatus(status: { code: number; message?: string }): this {
    this.status = status;
    return this;
  }
  updateName(): this {
    return this;
  }
  end(): void {
    this.ended = true;
  }
  isRecording(): boolean {
    return true;
  }
  recordException(exception: unknown): this {
    this.exceptions.push(exception);
    return this;
  }
}

class StubTracer implements Tracer {
  spans: StubSpan[] = [];
  startSpan(name: string): Span {
    const span = new StubSpan(name);
    this.spans.push(span);
    return span;
  }
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    fn: F
  ): ReturnType<F> {
    const span = this.startSpan(name);
    try {
      return fn(span) as ReturnType<F>;
    } finally {
      span.end();
    }
  }
}

const provider = createTestProvider();
const tokensFor = (text: string): number => provider.countTokens(text);
const FIT_ERROR = /Cannot fit prompt/;

const text = (value: string): PromptPart => ({ type: "text", text: value });

function rootScope(
  ...children: (PromptMessageNode | PromptScope)[]
): PromptScope {
  return {
    kind: "scope",
    priority: 0,
    children,
  };
}

function userMessage(value: string): PromptMessageNode {
  return {
    kind: "message",
    role: "user",
    children: [text(value)],
  };
}

function omitScope(
  children: (PromptMessageNode | PromptScope)[],
  opts: { priority: number }
): PromptScope {
  const strategy: Strategy = () => null;
  return {
    kind: "scope",
    priority: opts.priority,
    children,
    strategy,
  };
}

describe("createOtelRenderHooks", () => {
  test("emits spans for fit lifecycle", async () => {
    const tracer = new StubTracer();
    const hooks = createOtelRenderHooks({ tracer });
    const element = rootScope(
      userMessage("A"),
      omitScope([userMessage("BBBB")], { priority: 1 })
    );

    await render(element, { provider, budget: tokensFor("A"), hooks });

    const names = tracer.spans.map((span) => span.name);
    expect(names).toEqual([
      "cria.fit",
      "cria.fit.iteration",
      "cria.fit.strategy",
    ]);

    const rootSpan = tracer.spans[0];
    expect(rootSpan).toBeDefined();
    expect(rootSpan?.attributes["cria.budget"]).toBe(1);
    expect(typeof rootSpan?.attributes["cria.total_tokens"]).toBe("number");
  });

  test("records errors on fit failure", async () => {
    const tracer = new StubTracer();
    const hooks = createOtelRenderHooks({ tracer });
    const element = rootScope(userMessage("Too long"));

    await expect(
      render(element, {
        provider,
        budget: Math.max(0, tokensFor("Too long") - 1),
        hooks,
      })
    ).rejects.toThrow(FIT_ERROR);

    const errorSpan = tracer.spans.at(-1) as StubSpan;
    expect(errorSpan.status?.code).toBeDefined();
    expect(errorSpan.exceptions).toHaveLength(1);
  });

  test("propagates tracer errors", async () => {
    const tracer = {
      startSpan: () => {
        throw new Error("boom");
      },
    } as unknown as Tracer;

    const hooks = createOtelRenderHooks({ tracer });
    const element = rootScope(userMessage("Hello"));

    await expect(
      render(element, {
        provider,
        budget: Math.max(0, tokensFor("Hello") - 1),
        hooks,
      })
    ).rejects.toThrow("boom");
  });
});
