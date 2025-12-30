import assert from "node:assert/strict";
import { test } from "node:test";
import { Omit, Region, render, Truncate } from "./index";

// Simple tokenizer: 1 token per 4 characters (approximates real tokenizers)
const tokenizer = (text: string): number => Math.ceil(text.length / 4);

const FIT_ERROR_PATTERN = /Cannot fit prompt/;

test("render: basic text output", () => {
  const element = <Region priority={0}>Hello, world!</Region>;
  const result = render(element, { tokenizer, budget: 100 });
  assert.strictEqual(result, "Hello, world!");
});

test("render: nested regions", () => {
  const element = (
    <Region priority={0}>
      Start <Region priority={1}>Middle</Region> End
    </Region>
  );
  const result = render(element, { tokenizer, budget: 100 });
  assert.strictEqual(result, "Start Middle End");
});

test("render: omit removes region when over budget", () => {
  const element = (
    <Region priority={0}>
      Important{" "}
      <Omit priority={1}>Less important content that should be removed</Omit>
      Also important
    </Region>
  );

  const resultLarge = render(element, { tokenizer, budget: 100 });
  assert.ok(resultLarge.includes("Less important"));

  const resultSmall = render(element, { tokenizer, budget: 10 });
  assert.ok(!resultSmall.includes("Less important"));
  assert.ok(resultSmall.includes("Important"));
});

test("render: truncate reduces content", () => {
  const longContent = "A".repeat(100);
  const element = (
    <Region priority={0}>
      Header{" "}
      <Truncate budget={5} priority={1}>
        {longContent}
      </Truncate>
    </Region>
  );

  const result = render(element, { tokenizer, budget: 10 });
  assert.ok(result.length < 100);
  assert.ok(result.includes("Header"));
});

test("render: priority ordering - lower priority removed first", () => {
  const element = (
    <Region priority={0}>
      <Region priority={0}>Critical</Region>
      <Omit priority={1}>Medium importance</Omit>
      <Omit priority={2}>Low importance</Omit>
    </Region>
  );

  const result = render(element, { tokenizer, budget: 5 });
  assert.ok(result.includes("Critical"));
  assert.ok(!result.includes("Medium"));
  assert.ok(!result.includes("Low"));
});

test("render: throws FitError when cannot fit", () => {
  const element = (
    <Region priority={0}>
      This content has no strategy and cannot be reduced
    </Region>
  );

  assert.throws(
    () => render(element, { tokenizer, budget: 1 }),
    FIT_ERROR_PATTERN
  );
});

test("render: multiple strategies at same priority applied together", () => {
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

  const result = render(element, { tokenizer, budget: 0 });
  assert.strictEqual(result, "");
});
