import { expect, test } from "vitest";
import { Message, Omit, render, Scope, Truncate } from "./index";
import type { FitErrorEvent } from "./render";
import { createTestProvider } from "./testing/plaintext";
import type { PromptNode, PromptPart } from "./types";

const provider = createTestProvider();
const tokensFor = (text: string): number => provider.countTokens(text);

const FIT_ERROR_PATTERN = /Cannot fit prompt/;

const text = (value: string): PromptPart => ({ type: "text", text: value });

const rootScope = (...children: PromptNode[]) =>
  Scope({ priority: 0, children });

const userMessage = (value: string) =>
  Message({ messageRole: "user", children: [text(value)] });

const assistantMessage = (value: string) =>
  Message({ messageRole: "assistant", children: [text(value)] });

test("render: basic text output", async () => {
  const element = rootScope(userMessage("Hello, world!"));
  const result = await render(element, {
    provider,
    budget: tokensFor("Hello, world!"),
  });
  expect(result).toBe("Hello, world!");
});

test("render: nested scopes", async () => {
  const element = rootScope(
    Scope({ priority: 0, children: [userMessage("Start ")] }),
    Scope({ priority: 0, children: [userMessage("Middle")] }),
    Scope({ priority: 0, children: [userMessage(" End")] })
  );
  const result = await render(element, {
    provider,
    budget: tokensFor("Start Middle End"),
  });
  expect(result).toBe("Start Middle End");
});

test("render: omit removes scope when over budget", async () => {
  const element = rootScope(
    userMessage("Important "),
    Omit({
      priority: 1,
      children: [userMessage("Less important content that should be removed")],
    }),
    userMessage("Also important")
  );

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
  const element = rootScope(
    userMessage("Head "),
    Truncate({
      budget: 4,
      priority: 1,
      children: [userMessage("Alpha "), userMessage("Beta")],
    })
  );

  const truncated = "Head Beta";
  const result = await render(element, {
    provider,
    budget: tokensFor(truncated),
  });
  expect(result).toBe(truncated);
});

test("render: priority ordering - lower priority removed first", async () => {
  const element = rootScope(
    Scope({ priority: 0, children: [userMessage("Critical")] }),
    Omit({ priority: 1, children: [userMessage("Medium importance")] }),
    Omit({ priority: 2, children: [userMessage("Low importance")] })
  );

  const result = await render(element, {
    provider,
    budget: tokensFor("Critical"),
  });
  expect(result).toBe("Critical");
});

test("render: throws FitError when cannot fit", async () => {
  const element = rootScope(
    userMessage("This content has no strategy and cannot be reduced")
  );

  const tooLong = "This content has no strategy and cannot be reduced";
  await expect(
    render(element, {
      provider,
      budget: Math.max(0, tokensFor(tooLong) - 1),
    })
  ).rejects.toThrow(FIT_ERROR_PATTERN);
});

test("render: multiple strategies at same priority applied together", async () => {
  const element = rootScope(
    Omit({ id: "a", priority: 1, children: [userMessage("AAA")] }),
    Omit({ id: "b", priority: 1, children: [userMessage("BBB")] })
  );

  const result = await render(element, { provider, budget: 0 });
  expect(result).toBe("");
});

test("render: hooks fire in expected order", async () => {
  const calls: string[] = [];
  const element = rootScope(
    userMessage("A"),
    Omit({ priority: 1, children: [userMessage("BBBB")] })
  );

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
  const element = rootScope(userMessage("Too long"));
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
  const element = rootScope(
    userMessage("A"),
    Omit({ priority: 1, children: [userMessage("BBBB")] })
  );

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
  const element = rootScope(
    userMessage("A"),
    Omit({ priority: 1, children: [userMessage("BBBB")] })
  );

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
  const element = rootScope(
    assistantMessage("Hello "),
    Message({
      messageRole: "assistant",
      children: [
        { type: "reasoning", text: "Thinking" },
        { type: "tool-call", toolCallId: "c1", toolName: "calc", input: 1 },
      ],
    })
  );

  const result = await render(element, {
    provider,
    budget: tokensFor("Hello Thinking[tool-call:calc]1"),
  });
  expect(result).toContain("Hello");
});
