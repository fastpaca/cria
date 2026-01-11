import { describe, expect, test } from "vitest";
import { Message, Omit, Region, Truncate } from "./components";
import { cria, PromptBuilder, prompt } from "./dsl";
import { render } from "./render";
import type { PromptElement } from "./types";

const tokenizer = (text: string): number => text.length;

describe("PromptBuilder", () => {
  describe("basic usage", () => {
    test("creates empty builder with cria.prompt()", () => {
      const builder = cria.prompt();
      expect(builder).toBeInstanceOf(PromptBuilder);
    });

    test("creates empty builder with prompt()", () => {
      const builder = prompt();
      expect(builder).toBeInstanceOf(PromptBuilder);
    });

    test("builds empty region", async () => {
      const element = await cria.prompt().build();
      const result = await render(element, { tokenizer, budget: 100 });
      expect(result).toBe("");
    });

    test("render() convenience returns rendered output", async () => {
      const output = await cria
        .prompt()
        .system("Hello")
        .user("World")
        .render({ tokenizer, budget: 100 });

      expect(output).toContain("Hello");
      expect(output).toContain("World");
    });
  });

  describe("messages", () => {
    test("system() adds a system message", async () => {
      const element = await cria.prompt().system("You are helpful.").build();

      const result = await render(element, { tokenizer, budget: 100 });
      expect(result).toContain("You are helpful.");
    });

    test("user() adds a user message", async () => {
      const element = await cria.prompt().user("Hello!").build();

      const result = await render(element, { tokenizer, budget: 100 });
      expect(result).toContain("Hello!");
    });

    test("assistant() adds an assistant message", async () => {
      const element = await cria.prompt().assistant("Hi there!").build();

      const result = await render(element, { tokenizer, budget: 100 });
      expect(result).toContain("Hi there!");
    });

    test("message() adds a custom role message", async () => {
      const element = await cria.prompt().message("tool", "Result: 42").build();

      const result = await render(element, { tokenizer, budget: 100 });
      expect(result).toContain("Result: 42");
    });

    test("chained messages render in order", async () => {
      const element = await cria
        .prompt()
        .system("System prompt.")
        .user("User message.")
        .assistant("Assistant response.")
        .build();

      const result = await render(element, { tokenizer, budget: 200 });
      expect(result).toContain("System prompt.");
      expect(result).toContain("User message.");
      expect(result).toContain("Assistant response.");
    });
  });

  describe("strategies", () => {
    test("truncate() creates truncatable content", async () => {
      const longContent = "x".repeat(100);
      const element = await cria
        .prompt()
        .truncate(longContent, { budget: 10, priority: 1 })
        .build();

      // With a small budget, content should be truncated
      const result = await render(element, { tokenizer, budget: 20 });
      expect(result.length).toBeLessThan(100);
    });

    test("omit() creates omittable content", async () => {
      const element = await cria
        .prompt()
        .system("Required.")
        .omit("Optional content", { priority: 2 })
        .build();

      // With tight budget, omittable content is removed
      // Budget needs to account for "System: Required.\n\n" format
      const result = await render(element, { tokenizer, budget: 30 });
      expect(result).toContain("Required.");
      expect(result).not.toContain("Optional");
    });
  });

  describe("sections", () => {
    test("section() creates nested region", async () => {
      const element = await cria
        .prompt()
        .section((s) => s.system("Nested content"))
        .build();

      const result = await render(element, { tokenizer, budget: 100 });
      expect(result).toContain("Nested content");
    });

    test("named section sets id", () => {
      const elementPromise = cria
        .prompt()
        .section("my-section", (s) => s.system("Content"))
        .build();

      // Check that the element has a nested region with the correct id
      return elementPromise.then((element) => {
        expect(element.children).toHaveLength(1);
        const section = element.children[0] as PromptElement;
        expect(section.id).toBe("my-section");
      });
    });

    test("nested sections work", async () => {
      const element = await cria
        .prompt()
        .section("outer", (o) =>
          o.system("Outer").section("inner", (i) => i.user("Inner"))
        )
        .build();

      const result = await render(element, { tokenizer, budget: 100 });
      expect(result).toContain("Outer");
      expect(result).toContain("Inner");
    });
  });

  describe("utilities", () => {
    test("examples() creates example list", async () => {
      const element = await cria
        .prompt()
        .examples("Examples:", ["One", "Two", "Three"])
        .build();

      const result = await render(element, { tokenizer, budget: 200 });
      expect(result).toContain("Examples:");
      expect(result).toContain("One");
      expect(result).toContain("Two");
      expect(result).toContain("Three");
    });

    test("raw() adds arbitrary element", async () => {
      const custom: PromptElement = {
        priority: 0,
        children: ["Custom content"],
      };

      const element = await cria.prompt().raw(custom).build();

      const result = await render(element, { tokenizer, budget: 100 });
      expect(result).toBe("Custom content");
    });
  });

  describe("immutability", () => {
    test("each method returns a new builder", () => {
      const b1 = cria.prompt();
      const b2 = b1.system("Hello");
      const b3 = b2.user("World");

      expect(b1).not.toBe(b2);
      expect(b2).not.toBe(b3);
    });

    test("original builder is not modified", async () => {
      const b1 = cria.prompt().system("Original");
      const b2 = b1.user("Added");

      const r1 = await render(await b1.build(), { tokenizer, budget: 100 });
      const r2 = await render(await b2.build(), { tokenizer, budget: 100 });

      expect(r1).toContain("Original");
      expect(r1).not.toContain("Added");
      expect(r2).toContain("Original");
      expect(r2).toContain("Added");
    });
  });

  describe("composition helpers", () => {
    test("merge concatenates builders", async () => {
      const a = cria.prompt().system("A");
      const b = cria.prompt().user("B");

      const merged = a.merge(b);
      const result = await merged.render({ tokenizer, budget: 100 });

      expect(result).toContain("A");
      expect(result).toContain("B");
    });

    test("union aliases merge", async () => {
      const a = cria.prompt().system("A");
      const b = cria.prompt().user("B");

      const merged = cria.union(a, b);
      const result = await merged.render({ tokenizer, budget: 100 });

      expect(result).toContain("A");
      expect(result).toContain("B");
    });
  });

  // JSX compatibility: ensure DSL output matches JSX shape for parity. DSL is primary.
  describe("equivalence with JSX components", () => {
    test("DSL produces same output as JSX for messages", async () => {
      const dslElement = await cria
        .prompt()
        .system("You are helpful.")
        .user("Hello!")
        .build();

      // Equivalent JSX structure
      const jsxElement = Region({
        priority: 0,
        children: [
          Message({ messageRole: "system", children: ["You are helpful."] }),
          Message({ messageRole: "user", children: ["Hello!"] }),
        ],
      });

      const dslResult = await render(dslElement, { tokenizer, budget: 100 });
      const jsxResult = await render(jsxElement, { tokenizer, budget: 100 });

      expect(dslResult).toBe(jsxResult);
    });

    test("DSL produces same output as JSX for truncate", async () => {
      const content = "x".repeat(50);

      const dslElement = await cria
        .prompt()
        .truncate(content, { budget: 10, priority: 1 })
        .build();

      const jsxElement = Region({
        priority: 0,
        children: [Truncate({ budget: 10, priority: 1, children: [content] })],
      });

      const dslResult = await render(dslElement, { tokenizer, budget: 20 });
      const jsxResult = await render(jsxElement, { tokenizer, budget: 20 });

      expect(dslResult).toBe(jsxResult);
    });

    test("DSL produces same output as JSX for omit", async () => {
      const dslElement = await cria
        .prompt()
        .system("Required")
        .omit("Optional", { priority: 2 })
        .build();

      const jsxElement = Region({
        priority: 0,
        children: [
          Message({ messageRole: "system", children: ["Required"] }),
          Omit({ priority: 2, children: ["Optional"] }),
        ],
      });

      // Budget needs to account for "System: Required\n\n" format
      const dslResult = await render(dslElement, { tokenizer, budget: 30 });
      const jsxResult = await render(jsxElement, { tokenizer, budget: 30 });

      expect(dslResult).toBe(jsxResult);
    });
  });

  describe("content types", () => {
    test("truncate accepts string content", async () => {
      const element = await cria
        .prompt()
        .truncate("string content", { budget: 100 })
        .build();

      const result = await render(element, { tokenizer, budget: 200 });
      expect(result).toBe("string content");
    });

    test("truncate accepts PromptElement content", async () => {
      const inner = Message({
        messageRole: "user",
        children: ["element content"],
      });
      const element = await cria
        .prompt()
        .truncate(inner, { budget: 100 })
        .build();

      const result = await render(element, { tokenizer, budget: 200 });
      expect(result).toContain("element content");
    });

    test("truncate accepts PromptBuilder content", async () => {
      const innerBuilder = cria.prompt().user("builder content");
      const element = await cria
        .prompt()
        .truncate(innerBuilder, { budget: 100 })
        .build();

      const result = await render(element, { tokenizer, budget: 200 });
      expect(result).toContain("builder content");
    });
  });

  test("region() alias works", async () => {
    const element = await cria
      .prompt()
      .region((r) => r.user("Region content"))
      .build();

    const result = await render(element, { tokenizer, budget: 100 });
    expect(result).toContain("Region content");
  });
});
