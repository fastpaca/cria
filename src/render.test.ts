import { expect, test } from "vitest";
import { cria, Message, Omit, Region, render, Truncate } from "./index";
import type { FitErrorEvent } from "./render";
import { createTestProvider } from "./testing/plaintext";

const provider = createTestProvider();
const tokensFor = (text: string): number => provider.countTokens(text);

const FIT_ERROR_PATTERN = /Cannot fit prompt/;

test("render: basic text output", async () => {
  const element = Message({
    messageRole: "user",
    children: ["Hello, world!"],
  });
  const result = await render(element, {
    provider,
    budget: tokensFor("Hello, world!"),
  });
  expect(result).toBe("Hello, world!");
});

test("render: nested regions", async () => {
  const element = Message({
    messageRole: "user",
    children: ["Start ", Region({ priority: 1, children: ["Middle"] }), " End"],
  });
  const result = await render(element, {
    provider,
    budget: tokensFor("Start Middle End"),
  });
  expect(result).toBe("Start Middle End");
});

test("render: omit removes region when over budget", async () => {
  const element = Message({
    messageRole: "user",
    children: [
      "Important ",
      Omit({
        priority: 1,
        children: ["Less important content that should be removed"],
      }),
      "Also important",
    ],
  });

  const full =
    "Important Less important content that should be removedAlso important";
  const reduced = "Important Also important";

  const resultLarge = await render(element, {
    provider,
    budget: tokensFor(full),
  });
  expect(resultLarge).toBe(
    "Important Less important content that should be removedAlso important"
  );

  const resultSmall = await render(element, {
    provider,
    budget: tokensFor(reduced),
  });
  expect(resultSmall).toBe("Important Also important");
});

test("render: truncate reduces content", async () => {
  const element = Message({
    messageRole: "user",
    children: [
      "Head ",
      Truncate({
        budget: 4,
        priority: 1,
        children: ["Alpha ", "Beta"],
      }),
    ],
  });

  const truncated = "Head Beta";
  const result = await render(element, {
    provider,
    budget: tokensFor(truncated),
  });
  expect(result).toBe(truncated);
});

test("render: priority ordering - lower priority removed first", async () => {
  const element = Message({
    messageRole: "user",
    children: [
      Region({ priority: 0, children: ["Critical"] }),
      Omit({ priority: 1, children: ["Medium importance"] }),
      Omit({ priority: 2, children: ["Low importance"] }),
    ],
  });

  const result = await render(element, {
    provider,
    budget: tokensFor("Critical"),
  });
  expect(result).toBe("Critical");
});

test("render: throws FitError when cannot fit", async () => {
  const element = Message({
    messageRole: "user",
    children: ["This content has no strategy and cannot be reduced"],
  });

  const tooLong = "This content has no strategy and cannot be reduced";
  await expect(
    render(element, {
      provider,
      budget: Math.max(0, tokensFor(tooLong) - 1),
    })
  ).rejects.toThrow(FIT_ERROR_PATTERN);
});

test("render: multiple strategies at same priority applied together", async () => {
  const element = Message({
    messageRole: "user",
    children: [
      Omit({ id: "a", priority: 1, children: ["AAA"] }),
      Omit({ id: "b", priority: 1, children: ["BBB"] }),
    ],
  });

  const result = await render(element, { provider, budget: 0 });
  expect(result).toBe("");
});

test("render: hooks fire in expected order", async () => {
  const calls: string[] = [];
  const element = Message({
    messageRole: "user",
    children: ["A", Omit({ priority: 1, children: ["BBBB"] })],
  });

  const result = await render(element, {
    provider,
    budget: tokensFor("A"),
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
  const element = Message({ messageRole: "user", children: ["Too long"] });
  let errorEvent: FitErrorEvent | null = null;

  await expect(
    render(element, {
      provider,
      budget: Math.max(0, tokensFor("Too long") - 1),
      hooks: {
        onFitError: (event) => {
          errorEvent = event;
        },
      },
    })
  ).rejects.toThrow(FIT_ERROR_PATTERN);

  expect(errorEvent).not.toBeNull();
  expect((errorEvent as FitErrorEvent | null)?.priority).toBe(-1);
});

test("render: hook errors bubble (sync error)", async () => {
  const element = Message({
    messageRole: "user",
    children: ["A", Omit({ priority: 1, children: ["BBBB"] })],
  });

  await expect(
    render(element, {
      provider,
      budget: Math.max(0, tokensFor("ABBBB") - 1),
      hooks: {
        onFitStart: () => {
          throw new Error("Hook error");
        },
      },
    })
  ).rejects.toThrow("Hook error");
});

test("render: hook errors bubble (async error)", async () => {
  const element = Message({
    messageRole: "user",
    children: ["A", Omit({ priority: 1, children: ["BBBB"] })],
  });

  await expect(
    render(element, {
      provider,
      budget: Math.max(0, tokensFor("ABBBB") - 1),
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
  const element = Message({ messageRole: "user", children: ["Too long"] });

  await expect(
    render(element, {
      provider,
      budget: Math.max(0, tokensFor("Too long") - 1),
      hooks: {
        onFitError: () => {
          throw new Error("Error hook failed");
        },
      },
    })
  ).rejects.toThrow("Error hook failed");
});

test("render: DSL builder basic text output", async () => {
  const prompt = cria.prompt().user("Hello, world!");
  const result = await render(await prompt.build(), {
    provider,
    budget: tokensFor("Hello, world!"),
  });
  expect(result).toBe("Hello, world!");
});

test("render: DSL omit removes scope when over budget", async () => {
  const prompt = cria
    .prompt()
    .user((r) =>
      r
        .append("Important ")
        .omit("Less important content that should be removed", { priority: 1 })
        .append("Also important")
    );

  const full =
    "Important Less important content that should be removedAlso important";
  const reduced = "Important Also important";

  const resultLarge = await prompt.render({
    provider,
    budget: tokensFor(full),
  });
  expect(resultLarge).toBe(
    "Important Less important content that should be removedAlso important"
  );

  const resultSmall = await prompt.render({
    provider,
    budget: tokensFor(reduced),
  });
  expect(resultSmall).toBe("Important Also important");
});

test("render: DSL truncate reduces content", async () => {
  const prompt = cria
    .prompt()
    .user((r) =>
      r.append("Head ").truncate(["Alpha ", "Beta"], { budget: 4, priority: 1 })
    );

  const result = await prompt.render({
    provider,
    budget: tokensFor("Head Beta"),
  });
  expect(result).toBe("Head Beta");
});

test("render: DSL priority ordering - lower priority removed first", async () => {
  const prompt = cria.prompt().user((r) =>
    r
      .scope((child) => child.append("Critical"))
      .omit("Medium importance", { priority: 1 })
      .omit("Low importance", { priority: 2 })
  );

  const result = await prompt.render({
    provider,
    budget: tokensFor("Critical"),
  });
  expect(result).toBe("Critical");
});

test("render: DSL throws FitError when cannot fit", async () => {
  const prompt = cria
    .prompt()
    .user("This content has no strategy and cannot be reduced");

  const tooLong = "This content has no strategy and cannot be reduced";
  await expect(
    prompt.render({
      provider,
      budget: Math.max(0, tokensFor(tooLong) - 1),
    })
  ).rejects.toThrow(FIT_ERROR_PATTERN);
});

test("render: DSL hook order via render() convenience", async () => {
  const calls: string[] = [];
  const prompt = cria
    .prompt()
    .user((r) => r.append("A").omit("BBBB", { priority: 1 }));

  const result = await prompt.render({
    provider,
    budget: tokensFor("A"),
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

test("render: fit decisions are deterministic", async () => {
  const buildTree = () =>
    Message({
      messageRole: "user",
      children: [
        "Head ",
        Omit({ priority: 3, children: ["Drop"] }),
        Truncate({ budget: 4, priority: 2, children: ["A", "B", "C"] }),
        Region({ priority: 1, children: ["End"] }),
      ],
    });

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

  const runOnce = async (): Promise<{ result: string; events: EventLog[] }> => {
    const events: EventLog[] = [];
    const full = "Head DropABCEnd";

    const result = await render(buildTree(), {
      provider,
      budget: Math.max(0, tokensFor(full) - 1),
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
