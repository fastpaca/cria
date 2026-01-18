import { describe, expect, test } from "vitest";
import { render } from "../render";
import { createTestProvider } from "../testing/plaintext";
import { CodeBlock, Examples, Message, Region, Separator } from "./index";

const provider = createTestProvider();
const tokensFor = (text: string): number => provider.countTokens(text);

describe("Separator", () => {
  test("inserts separators between children", async () => {
    const element = Message({
      messageRole: "user",
      children: [
        Separator({
          priority: 0,
          value: " | ",
          children: [
            Region({ priority: 0, children: ["A"] }),
            Region({ priority: 0, children: ["B"] }),
            Region({ priority: 0, children: ["C"] }),
          ],
        }),
      ],
    });

    const result = await render(element, {
      provider,
      budget: tokensFor("A | B | C"),
    });
    expect(result).toBe("A | B | C");
  });
});

describe("Examples", () => {
  test("prefixes title and separates examples", async () => {
    const element = Message({
      messageRole: "user",
      children: [
        Examples({
          priority: 1,
          separator: "\n---\n",
          title: "Examples:",
          children: [
            Region({ priority: 0, children: ["One"] }),
            Region({ priority: 0, children: ["Two"] }),
          ],
        }),
      ],
    });

    const result = await render(element, {
      provider,
      budget: tokensFor("Examples:\nOne\n---\nTwo"),
    });
    expect(result).toBe("Examples:\nOne\n---\nTwo");
  });
});

describe("CodeBlock", () => {
  test("renders fenced code", async () => {
    const element = Message({
      messageRole: "user",
      children: [CodeBlock({ code: "console.log('hi');", language: "js" })],
    });
    const result = await render(element, {
      provider,
      budget: tokensFor("```js\nconsole.log('hi');\n```\n"),
    });
    expect(result).toBe("```js\nconsole.log('hi');\n```\n");
  });
});
