import { expect, test } from "vitest";
import { Omit, Region, render, Truncate } from "./index";

// Simple tokenizer: 1 token per 4 characters (approximates real tokenizers)
const tokenizer = (text: string): number => Math.ceil(text.length / 4);

const FIT_ERROR_PATTERN = /Cannot fit prompt/;

test("render: basic text output", async () => {
  const element = <Region priority={0}>Hello, world!</Region>;
  const result = await render(element, { tokenizer, budget: 100 });
  expect(result).toBe("Hello, world!");
});

test("render: nested regions", async () => {
  const element = (
    <Region priority={0}>
      Start <Region priority={1}>Middle</Region> End
    </Region>
  );
  const result = await render(element, { tokenizer, budget: 100 });
  expect(result).toBe("Start Middle End");
});

test("render: omit removes region when over budget", async () => {
  const element = (
    <Region priority={0}>
      Important{" "}
      <Omit priority={1}>Less important content that should be removed</Omit>
      Also important
    </Region>
  );

  const resultLarge = await render(element, { tokenizer, budget: 100 });
  expect(resultLarge).toContain("Less important");

  const resultSmall = await render(element, { tokenizer, budget: 10 });
  expect(resultSmall).not.toContain("Less important");
  expect(resultSmall).toContain("Important");
});

test("render: truncate reduces content", async () => {
  const longContent = "A".repeat(100);
  const element = (
    <Region priority={0}>
      Header{" "}
      <Truncate budget={5} priority={1}>
        {longContent}
      </Truncate>
    </Region>
  );

  const result = await render(element, { tokenizer, budget: 10 });
  expect(result.length).toBeLessThan(100);
  expect(result).toContain("Header");
});

test("render: priority ordering - lower priority removed first", async () => {
  const element = (
    <Region priority={0}>
      <Region priority={0}>Critical</Region>
      <Omit priority={1}>Medium importance</Omit>
      <Omit priority={2}>Low importance</Omit>
    </Region>
  );

  const result = await render(element, { tokenizer, budget: 5 });
  expect(result).toContain("Critical");
  expect(result).not.toContain("Medium");
  expect(result).not.toContain("Low");
});

test("render: throws FitError when cannot fit", async () => {
  const element = (
    <Region priority={0}>
      This content has no strategy and cannot be reduced
    </Region>
  );

  await expect(render(element, { tokenizer, budget: 1 })).rejects.toThrow(
    FIT_ERROR_PATTERN
  );
});

test("render: multiple strategies at same priority applied together", async () => {
  const element = (
    <Region priority={0}>
      <Omit id="a" priority={1}>
        AAA
      </Omit>
      <Omit id="b" priority={1}>
        BBB
      </Omit>
    </Region>
  );

  const result = await render(element, { tokenizer, budget: 0 });
  expect(result).toBe("");
});

test("render: hooks fire in expected order", async () => {
  const calls: string[] = [];
  const element = (
    <Region priority={0}>
      A<Omit priority={1}>BBBB</Omit>
    </Region>
  );

  const result = await render(element, {
    tokenizer,
    budget: 1,
    hooks: {
      onFitStart: () => {
        calls.push("start");
      },
      onFitIteration: () => {
        calls.push("iteration");
      },
      onStrategyApplied: () => {
        calls.push("strategy");
      },
      onFitComplete: () => {
        calls.push("complete");
      },
    },
  });

  expect(result).toBe("A");
  expect(calls).toEqual(["start", "iteration", "strategy", "complete"]);
});

test("render: onFitError fires before FitError throws", async () => {
  const element = <Region priority={0}>Too long</Region>;
  let errorEvent: { priority: number } | null = null;

  await expect(
    render(element, {
      tokenizer,
      budget: 1,
      hooks: {
        onFitError: (event) => {
          errorEvent = { priority: event.priority };
        },
      },
    })
  ).rejects.toThrow(FIT_ERROR_PATTERN);

  expect(errorEvent?.priority).toBe(-1);
});

test("render: hook errors bubble (sync error)", async () => {
  const element = (
    <Region priority={0}>
      A<Omit priority={1}>BBBB</Omit>
    </Region>
  );

  await expect(
    render(element, {
      tokenizer,
      budget: 1,
      hooks: {
        onFitStart: () => {
          throw new Error("Hook error");
        },
      },
    })
  ).rejects.toThrow("Hook error");
});

test("render: hook errors bubble (async error)", async () => {
  const element = (
    <Region priority={0}>
      A<Omit priority={1}>BBBB</Omit>
    </Region>
  );

  await expect(
    render(element, {
      tokenizer,
      budget: 1,
      hooks: {
        onFitComplete: async () => {
          await Promise.resolve();
          throw new Error("Async hook error");
        },
      },
    })
  ).rejects.toThrow("Async hook error");
});

test("render: onFitError hook errors bubble", async () => {
  const element = <Region priority={0}>Too long</Region>;

  await expect(
    render(element, {
      tokenizer,
      budget: 1,
      hooks: {
        onFitError: () => {
          throw new Error("Error hook failed");
        },
      },
    })
  ).rejects.toThrow("Error hook failed");
});

test("render: fit decisions are deterministic", async () => {
  const buildTree = () => (
    <Region priority={0}>
      Head <Omit priority={3}>Drop</Omit>
      <Truncate budget={4} priority={2}>
        LongTail
      </Truncate>
      <Region priority={1}>End</Region>
    </Region>
  );

  type EventLog =
    | { type: "start"; totalTokens: number }
    | { type: "iteration"; iteration: number; priority: number; totalTokens: number }
    | { type: "strategy"; iteration: number; priority: number; resultType: "node" | "null" }
    | { type: "complete"; iterations: number; totalTokens: number };

  const runOnce = async (): Promise<{ result: string; events: EventLog[] }> => {
    const events: EventLog[] = [];

    const result = await render(buildTree(), {
      tokenizer,
      budget: 12,
      hooks: {
        onFitStart: (event) => {
          events.push({ type: "start", totalTokens: event.totalTokens });
        },
        onFitIteration: (event) => {
          events.push({
            type: "iteration",
            iteration: event.iteration,
            priority: event.priority,
            totalTokens: event.totalTokens,
          });
        },
        onStrategyApplied: (event) => {
          events.push({
            type: "strategy",
            iteration: event.iteration,
            priority: event.priority,
            resultType: event.result ? "node" : "null",
          });
        },
        onFitComplete: (event) => {
          events.push({
            type: "complete",
            iterations: event.iterations,
            totalTokens: event.totalTokens,
          });
        },
      },
    });

    return { result, events };
  };

  const first = await runOnce();
  const second = await runOnce();

  expect(first.result).toBe(second.result);
  expect(first.events).toEqual(second.events);
});
