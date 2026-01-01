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
