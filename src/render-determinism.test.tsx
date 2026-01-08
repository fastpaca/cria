import { expect, test } from "vitest";
import { Omit, Region, Truncate, render } from "./index";

const tokenizer = (text: string): number => text.length;

type EventLog =
  | { type: "start"; totalTokens: number }
  | {
      type: "iteration";
      iteration: number;
      priority: number;
      totalTokens: number;
    }
  | {
      type: "strategy";
      iteration: number;
      priority: number;
      resultType: "node" | "null";
    }
  | { type: "complete"; iterations: number; totalTokens: number };

const buildTree = () => (
  <Region priority={0}>
    Head <Omit priority={3}>Drop</Omit>
    <Truncate priority={2} budget={4}>
      LongTail
    </Truncate>
    <Region priority={1}>End</Region>
  </Region>
);

test("fit loop decisions are deterministic for the same input", async () => {
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

  // Final output and the fit decision trace should be stable across runs.
  expect(first.result).toBe("Head TailEnd");
  expect(second.result).toBe("Head TailEnd");
  expect(first.events).toEqual(second.events);

  // Guard the expected decision trace to catch regressions.
  expect(first.events).toEqual([
    { type: "start", totalTokens: 20 },
    { type: "iteration", iteration: 1, priority: 3, totalTokens: 20 },
    { type: "strategy", iteration: 1, priority: 3, resultType: "null" },
    { type: "iteration", iteration: 2, priority: 2, totalTokens: 16 },
    { type: "strategy", iteration: 2, priority: 2, resultType: "node" },
    { type: "complete", iterations: 2, totalTokens: 12 },
  ]);
});
