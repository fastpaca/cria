import { expect, test } from "vitest";
import { cria } from "./dsl";
import { render } from "./render";

// Simple tokenizer: 1 token per 4 characters (approximates real tokenizers)
const tokenizer = (text: string): number => Math.ceil(text.length / 4);

const FIT_ERROR_PATTERN = /Cannot fit prompt/;

test("DSL render: basic text output", async () => {
  const prompt = cria
    .prompt()
    .raw({ priority: 0, children: ["Hello, world!"] });
  const result = await render(await prompt.build(), { tokenizer, budget: 100 });
  expect(result).toBe("Hello, world!");
});

test("DSL render: omit removes region when over budget", async () => {
  const prompt = cria.prompt().region((r) =>
    r
      .raw({ priority: 0, children: ["Important "] })
      .omit("Less important content that should be removed", { priority: 1 })
      .raw({ priority: 0, children: ["Also important"] })
  );

  const resultLarge = await prompt.render({ tokenizer, budget: 100 });
  expect(resultLarge).toContain("Less important");

  const resultSmall = await prompt.render({ tokenizer, budget: 10 });
  expect(resultSmall).not.toContain("Less important");
  expect(resultSmall).toContain("Important");
});

test("DSL render: truncate reduces content", async () => {
  const longContent = "A".repeat(100);
  const prompt = cria.prompt().region((r) =>
    r.raw({ priority: 0, children: ["Header "] }).truncate(longContent, {
      budget: 5,
      priority: 1,
    })
  );

  const result = await prompt.render({ tokenizer, budget: 10 });
  expect(result.length).toBeLessThan(100);
  expect(result).toContain("Header");
});

test("DSL render: priority ordering - lower priority removed first", async () => {
  const prompt = cria.prompt().region((r) =>
    r
      .region((child) => child.raw({ priority: 0, children: ["Critical"] }))
      .omit("Medium importance", { priority: 1 })
      .omit("Low importance", { priority: 2 })
  );

  const result = await prompt.render({ tokenizer, budget: 5 });
  expect(result).toContain("Critical");
  expect(result).not.toContain("Medium");
  expect(result).not.toContain("Low");
});

test("DSL render: throws FitError when cannot fit", async () => {
  const prompt = cria.prompt().raw({
    priority: 0,
    children: ["This content has no strategy and cannot be reduced"],
  });

  await expect(prompt.render({ tokenizer, budget: 1 })).rejects.toThrow(
    FIT_ERROR_PATTERN
  );
});

test("DSL render: hook order via render() convenience", async () => {
  const calls: string[] = [];
  const prompt = cria
    .prompt()
    .region((r) =>
      r.raw({ priority: 0, children: ["A"] }).omit("BBBB", { priority: 1 })
    );

  const result = await prompt.render({
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
