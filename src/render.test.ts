import { expect, test } from "vitest";
import { cria, render } from "./index";
import type { FitErrorEvent } from "./render";
import { createTestProvider } from "./testing/plaintext";
import type { PromptMessageNode, PromptScope, Strategy } from "./types";

const provider = createTestProvider();
const tokensFor = (text: string): number => provider.countTokens(text);

const FIT_ERROR_PATTERN = /Cannot fit prompt/;

/**
 * Creates an omit scope with a custom strategy for testing render behavior.
 * This is intentionally raw to test the render pipeline with specific behaviors.
 */
function omitScope(
  children: (PromptMessageNode | PromptScope)[],
  opts: { priority: number; id?: string }
): PromptScope {
  const strategy: Strategy = () => null;
  return {
    kind: "scope",
    priority: opts.priority,
    children,
    strategy,
    ...(opts.id && { id: opts.id }),
  };
}

/**
 * Creates a truncate scope with a custom strategy for testing render behavior.
 * This is intentionally raw to test the render pipeline with specific behaviors.
 */
function truncateScope(
  children: (PromptMessageNode | PromptScope)[],
  opts: { budget: number; priority: number }
): PromptScope {
  const strategy: Strategy = (input) => {
    const { children: currentChildren } = input.target;
    if (currentChildren.length === 0) {
      return null;
    }
    const dropCount = Math.max(1, Math.floor(input.totalTokens / opts.budget));
    const nextChildren = currentChildren.slice(dropCount);
    if (nextChildren.length === 0) {
      return null;
    }
    return { ...input.target, children: nextChildren };
  };
  return {
    kind: "scope",
    priority: opts.priority,
    children,
    strategy,
  };
}

test("render: basic text output", async () => {
  const element = cria.scope([cria.user("Hello, world!")]);
  const result = await render(element, {
    provider,
    budget: tokensFor("Hello, world!"),
  });
  expect(result).toBe("Hello, world!");
});

test("render: nested scopes", async () => {
  const element = cria.scope([
    cria.scope([cria.user("Start ")]),
    cria.scope([cria.user("Middle")]),
    cria.scope([cria.user(" End")]),
  ]);
  const result = await render(element, {
    provider,
    budget: tokensFor("Start Middle End"),
  });
  expect(result).toBe("Start Middle End");
});

test("render: omit removes scope when over budget", async () => {
  const element = cria.scope([
    cria.user("Important "),
    omitScope([cria.user("Less important content that should be removed")], {
      priority: 1,
    }),
    cria.user("Also important"),
  ]);

  const full =
    "Important Less important content that should be removedAlso important";
  const reduced = "Important Also important";

  const resultLarge = await render(element, {
    provider,
    budget: tokensFor(full),
  });
  expect(resultLarge).toBe(full);

  const resultSmall = await render(element, {
    provider,
    budget: tokensFor(reduced),
  });
  expect(resultSmall).toBe(reduced);
});

test("render: truncate reduces content", async () => {
  const element = cria.scope([
    cria.user("Head "),
    truncateScope([cria.user("Alpha "), cria.user("Beta")], {
      budget: 4,
      priority: 1,
    }),
  ]);

  const truncated = "Head Beta";
  const result = await render(element, {
    provider,
    budget: tokensFor(truncated),
  });
  expect(result).toBe(truncated);
});

test("render: priority ordering - lower priority removed first", async () => {
  const element = cria.scope([
    cria.scope([cria.user("Critical")]),
    omitScope([cria.user("Medium importance")], { priority: 1 }),
    omitScope([cria.user("Low importance")], { priority: 2 }),
  ]);

  const result = await render(element, {
    provider,
    budget: tokensFor("Critical"),
  });
  expect(result).toBe("Critical");
});

test("render: throws FitError when cannot fit", async () => {
  const element = cria.scope([
    cria.user("This content has no strategy and cannot be reduced"),
  ]);

  const tooLong = "This content has no strategy and cannot be reduced";
  await expect(
    render(element, {
      provider,
      budget: Math.max(0, tokensFor(tooLong) - 1),
    })
  ).rejects.toThrow(FIT_ERROR_PATTERN);
});

test("render: multiple strategies at same priority applied together", async () => {
  const element = cria.scope([
    omitScope([cria.user("AAA")], { id: "a", priority: 1 }),
    omitScope([cria.user("BBB")], { id: "b", priority: 1 }),
  ]);

  const result = await render(element, { provider, budget: 0 });
  expect(result).toBe("");
});

test("render: hooks fire in expected order", async () => {
  const calls: string[] = [];
  const element = cria.scope([
    cria.user("A"),
    omitScope([cria.user("BBBB")], { priority: 1 }),
  ]);

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
  const element = cria.scope([cria.user("Too long")]);
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
  const element = cria.scope([
    cria.user("A"),
    omitScope([cria.user("BBBB")], { priority: 1 }),
  ]);

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
  const element = cria.scope([
    cria.user("A"),
    omitScope([cria.user("BBBB")], { priority: 1 }),
  ]);

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

test("render: assistant message fields map to output", async () => {
  const element = cria.scope([
    cria.assistant("Hello "),
    {
      kind: "message",
      role: "assistant",
      children: [
        { type: "reasoning", text: "Thinking" },
        { type: "tool-call", toolCallId: "c1", toolName: "calc", input: 1 },
      ],
    },
  ]);

  const result = await render(element, {
    provider,
    budget: tokensFor("Hello Thinking[tool-call:calc]1"),
  });
  expect(result).toContain("Hello");
});
