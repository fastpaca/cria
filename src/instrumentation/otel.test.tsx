import type { Attributes, Span, Tracer } from "@opentelemetry/api";
import { describe, expect, test } from "vitest";
import { Omit, Region, render } from "../index";
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

  spanContext(): any {
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
  setStatus(status: any): this {
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
  recordException(exception: any): this {
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
}

const tokenizer = (text: string): number => text.length;
const FIT_ERROR = /Cannot fit prompt/;

describe("createOtelRenderHooks", () => {
  test("emits spans for fit lifecycle", async () => {
    const tracer = new StubTracer();
    const hooks = createOtelRenderHooks({ tracer });
    const element = (
      <Region priority={0}>
        A<Omit priority={1}>BBBB</Omit>
      </Region>
    );

    await render(element, { tokenizer, budget: 1, hooks });

    const names = tracer.spans.map((span) => span.name);
    expect(names).toEqual([
      "cria.fit",
      "cria.fit.iteration",
      "cria.fit.strategy",
    ]);

    const rootSpan = tracer.spans[0];
    expect(rootSpan.attributes["cria.budget"]).toBe(1);
    expect(typeof rootSpan.attributes["cria.total_tokens"]).toBe("number");
  });

  test("records errors on fit failure", async () => {
    const tracer = new StubTracer();
    const hooks = createOtelRenderHooks({ tracer });
    const element = <Region priority={0}>Too long</Region>;

    await expect(
      render(element, {
        tokenizer,
        budget: 1,
        hooks,
      })
    ).rejects.toThrow(FIT_ERROR);

    const errorSpan = tracer.spans.at(-1) as StubSpan;
    expect(errorSpan.status?.code).toBeDefined();
    expect(errorSpan.exceptions).toHaveLength(1);
  });

  test("propagates tracer errors", async () => {
    const tracer: Tracer = {
      startSpan: () => {
        throw new Error("boom");
      },
    } as Tracer;

    const hooks = createOtelRenderHooks({ tracer });
    const element = <Region priority={0}>Hello</Region>;

    await expect(
      render(element, {
        tokenizer,
        budget: 1,
        hooks,
      })
    ).rejects.toThrow("boom");
  });
});
