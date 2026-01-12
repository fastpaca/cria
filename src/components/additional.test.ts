import { describe, expect, test } from "vitest";
import { render } from "../render";
import { CodeBlock, Examples, Region, Separator } from "./index";

const tokenizer = (text: string): number => text.length;

describe("Separator", () => {
  test("inserts separators between children", async () => {
    const element = Separator({
      priority: 0,
      value: " | ",
      children: [
        Region({ priority: 0, children: ["A"] }),
        Region({ priority: 0, children: ["B"] }),
        Region({ priority: 0, children: ["C"] }),
      ],
    });

    const result = await render(element, { tokenizer, budget: 100 });
    expect(result).toBe("A | B | C");
  });
});

describe("Examples", () => {
  test("prefixes title and separates examples", async () => {
    const element = Examples({
      priority: 1,
      separator: "\n---\n",
      title: "Examples:",
      children: [
        Region({ priority: 0, children: ["One"] }),
        Region({ priority: 0, children: ["Two"] }),
      ],
    });

    const result = await render(element, { tokenizer, budget: 100 });
    expect(result).toBe("Examples:\nOne\n---\nTwo");
  });
});

describe("CodeBlock", () => {
  test("renders fenced code", async () => {
    const element = CodeBlock({ code: "console.log('hi');", language: "js" });
    const result = await render(element, { tokenizer, budget: 100 });
    expect(result).toBe("```js\nconsole.log('hi');\n```\n");
  });
});
