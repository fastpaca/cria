import { describe, expect, test } from "vitest";
import { CodeBlock, Examples, Region, Separator } from "./index";
import { render } from "../render";

const tokenizer = (text: string): number => text.length;

describe("Separator", () => {
  test("inserts separators between children", async () => {
    const element = (
      <Separator value=" | " priority={0}>
        <Region priority={0}>A</Region>
        <Region priority={0}>B</Region>
        <Region priority={0}>C</Region>
      </Separator>
    );

    const result = await render(element, { tokenizer, budget: 100 });
    expect(result).toBe("A | B | C");
  });
});

describe("Examples", () => {
  test("prefixes title and separates examples", async () => {
    const element = (
      <Examples title="Examples:" separator="\n---\n" priority={1}>
        <Region priority={0}>One</Region>
        <Region priority={0}>Two</Region>
      </Examples>
    );

    const result = await render(element, { tokenizer, budget: 100 });
    expect(result).toContain("Examples:\n");
    expect(result).toContain("One");
    expect(result).toContain("Two");
    expect(result).toContain("---");
  });
});

describe("CodeBlock", () => {
  test("renders fenced code", async () => {
    const element = <CodeBlock code="console.log('hi');" language="js" />;
    const result = await render(element, { tokenizer, budget: 100 });
    expect(result).toContain("```js");
    expect(result).toContain("console.log('hi');");
  });
});
