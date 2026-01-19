import { describe, expect, test } from "vitest";
import { render } from "../render";
import { createTestProvider } from "../testing/plaintext";
import { CodeBlock, Examples, Message, Separator } from "./index";

const provider = createTestProvider();
const tokensFor = (text: string): number => provider.countTokens(text);

describe("Separator", () => {
  test("inserts separators between children", async () => {
    const element = Message({
      messageRole: "user",
      children: [
        Separator({
          value: " | ",
          children: ["A", "B", "C"],
        }),
      ],
    });

    const result = await render(
      {
        kind: "scope",
        priority: 0,
        children: [element],
      },
      {
        provider,
        budget: tokensFor("A | B | C"),
      }
    );
    expect(result).toBe("A | B | C");
  });
});

describe("Examples", () => {
  test("prefixes title and separates examples", async () => {
    const element = Message({
      messageRole: "user",
      children: [
        Examples({
          separator: "\n---\n",
          title: "Examples:",
          children: ["One", "Two"],
        }),
      ],
    });

    const result = await render(
      {
        kind: "scope",
        priority: 0,
        children: [element],
      },
      {
        provider,
        budget: tokensFor("Examples:\nOne\n---\nTwo"),
      }
    );
    expect(result).toBe("Examples:\nOne\n---\nTwo");
  });
});

describe("CodeBlock", () => {
  test("renders fenced code", async () => {
    const element = Message({
      messageRole: "user",
      children: [CodeBlock({ code: "console.log('hi');", language: "js" })],
    });
    const result = await render(
      {
        kind: "scope",
        priority: 0,
        children: [element],
      },
      {
        provider,
        budget: tokensFor("```js\nconsole.log('hi');\n```\n"),
      }
    );
    expect(result).toBe("```js\nconsole.log('hi');\n```\n");
  });
});
