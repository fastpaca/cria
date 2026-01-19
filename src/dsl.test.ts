import { describe, expect, test } from "vitest";
import type { StoredSummary } from "./dsl";
import { c, cria, PromptBuilder, prompt } from "./dsl";
import { InMemoryStore } from "./memory";
import { render } from "./render";
import { createTestProvider } from "./testing/plaintext";
import type { PromptNode } from "./types";

const provider = createTestProvider({
  includeRolePrefix: true,
  joinMessagesWith: "\n\n",
});
const tokensFor = (text: string): number => provider.countTokens(text);

const renderBuilder = async <P>(
  builder: PromptBuilder<P>,
  budget = 10_000
): Promise<string> => render(await builder.build(), { provider, budget });

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

    test("builds empty scope", async () => {
      const element = await cria.prompt().build();
      const result = await render(element, { provider, budget: tokensFor("") });
      expect(result).toBe("");
    });

    test("render() convenience returns rendered output", async () => {
      const output = await cria
        .prompt()
        .system("Hello")
        .user("World")
        .render({
          provider,
          budget: tokensFor("system: Hello\n\nuser: World"),
        });

      expect(output).toBe("system: Hello\n\nuser: World");
    });

    test("render() uses bound provider when available", async () => {
      const output = await cria
        .prompt()
        .provider(provider)
        .system("Hello")
        .render({ budget: tokensFor("system: Hello") });

      expect(output).toBe("system: Hello");
    });
  });

  describe("messages", () => {
    test("system() adds a system message", async () => {
      const result = await renderBuilder(
        cria.prompt().system("You are helpful.")
      );
      expect(result).toBe("system: You are helpful.");
    });

    test("user() adds a user message", async () => {
      const result = await renderBuilder(cria.prompt().user("Hello!"));
      expect(result).toBe("user: Hello!");
    });

    test("assistant() adds an assistant message", async () => {
      const result = await renderBuilder(
        cria.prompt().assistant("Hi there! How can I help?")
      );
      expect(result).toBe("assistant: Hi there! How can I help?");
    });

    test("message() adds a message with explicit role", async () => {
      const result = await renderBuilder(
        cria.prompt().message("user", "Question: 42")
      );
      expect(result).toBe("user: Question: 42");
    });

    test("tool() adds a tool result message", async () => {
      const result = await renderBuilder(
        cria.prompt(provider).tool({
          type: "tool-result",
          toolCallId: "call_1",
          toolName: "calc",
          output: '{"answer":42}',
        })
      );
      expect(result).toBe('tool: [tool-result:calc]{"answer":42}');
    });

    test("chained messages render in order", async () => {
      const result = await renderBuilder(
        cria
          .prompt()
          .system("System prompt.")
          .user("User message.")
          .assistant("Assistant response.")
      );

      expect(result).toBe(
        "system: System prompt.\n\nuser: User message.\n\nassistant: Assistant response."
      );
    });

    test("message callbacks support appended content", async () => {
      const result = await renderBuilder(
        cria.prompt().user((m) => m.append(c`Hello `).append("World"))
      );

      expect(result).toBe("user: Hello World");
    });
  });

  describe("history", () => {
    test("history() appends provider-native history when bound", async () => {
      const output = await cria
        .prompt(provider)
        .history("Hello")
        .user("World")
        .render({ budget: tokensFor("user: Hello\n\nuser: World") });

      expect(output).toBe("user: Hello\n\nuser: World");
    });
  });

  describe("strategies", () => {
    test("truncate() shrinks scoped messages", async () => {
      const chunk = "x".repeat(50);
      const element = await cria
        .prompt()
        .truncate(cria.prompt().user(chunk).user(chunk).user(chunk), {
          budget: 500, // High budget = drop fewer children per iteration
          priority: 1,
        })
        .build();

      const full = `user: ${chunk}\n\nuser: ${chunk}\n\nuser: ${chunk}`;
      const result = await render(element, {
        provider,
        budget: Math.max(0, tokensFor(full) - 1),
      });
      expect(result).toContain("user:");
      expect(result.length).toBeLessThan(full.length);
    });

    test("omit() drops scoped messages", async () => {
      const element = await cria
        .prompt()
        .system("Required.")
        .omit(cria.prompt().system("Optional content"), { priority: 2 })
        .build();

      const result = await render(element, {
        provider,
        budget: tokensFor("system: Required."),
      });
      expect(result).toBe("system: Required.");
    });
  });

  describe("scopes", () => {
    test("scope() creates nested scope", async () => {
      const result = await renderBuilder(
        cria.prompt().scope((s) => s.system("Nested content"))
      );
      expect(result).toBe("system: Nested content");
    });

    test("named scope sets id", async () => {
      const element = await cria
        .prompt()
        .scope((s) => s.system("Content"), { id: "my-section" })
        .build();

      expect(element.children).toHaveLength(1);
      const section = element.children[0] as PromptNode;
      expect(section.kind).toBe("scope");
      if (section.kind === "scope") {
        expect(section.id).toBe("my-section");
      }
    });

    test("nested scopes work", async () => {
      const result = await renderBuilder(
        cria
          .prompt()
          .scope(
            (o) =>
              o.system("Outer").scope((i) => i.user("Inner"), { id: "inner" }),
            { id: "outer" }
          )
      );

      expect(result).toBe("system: Outer\n\nuser: Inner");
    });
  });

  describe("utilities", () => {
    test("examples() creates example list", async () => {
      const result = await renderBuilder(
        cria
          .prompt()
          .user((m) => m.examples("Examples:", ["One", "Two", "Three"]))
      );

      expect(result).toBe("user: Examples:\nOne\n\nTwo\n\nThree");
    });

    test("raw() adds arbitrary node", async () => {
      const custom: PromptNode = {
        kind: "message",
        role: "user",
        children: [{ type: "text", text: "Custom content" }],
      };

      const element = await cria.prompt().raw(custom).build();

      const result = await render(element, {
        provider,
        budget: tokensFor("user: Custom content"),
      });
      expect(result).toBe("user: Custom content");
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

      const r1 = await render(await b1.build(), {
        provider,
        budget: tokensFor("system: Original"),
      });
      const r2 = await render(await b2.build(), {
        provider,
        budget: tokensFor("system: Original\n\nuser: Added"),
      });

      expect(r1).toBe("system: Original");
      expect(r2).toBe("system: Original\n\nuser: Added");
    });
  });

  describe("composition helpers", () => {
    test("merge concatenates builders", async () => {
      const a = cria.prompt().system("A");
      const b = cria.prompt().user("B");

      const merged = a.merge(b);
      const result = await merged.render({
        provider,
        budget: tokensFor("system: A\n\nuser: B"),
      });

      expect(result).toBe("system: A\n\nuser: B");
    });
  });

  describe("provider binding", () => {
    test("merge rejects builders with different providers", () => {
      const providerA = createTestProvider({ includeRolePrefix: true });
      const providerB = createTestProvider({ includeRolePrefix: true });

      const a = cria.prompt(providerA).system("A");
      const b = cria.prompt(providerB).user("B");

      expect(() => a.merge(b)).toThrow(
        "Cannot merge builders with different contexts/providers"
      );
    });

    test("provider() rejects rebinding to a different provider", () => {
      const providerA = createTestProvider({ includeRolePrefix: true });
      const providerB = createTestProvider({ includeRolePrefix: true });

      const builder = cria.prompt(providerA);

      expect(() => builder.provider(providerB)).toThrow(
        "Cannot bind a prompt builder to a different provider."
      );
    });

    test("providerScope() rejects mismatched providers", () => {
      const providerA = createTestProvider({ includeRolePrefix: true });
      const providerB = createTestProvider({ includeRolePrefix: true });

      const builder = cria.prompt(providerA);

      expect(() =>
        builder.providerScope(providerB, (p) => p.system("Scoped"))
      ).toThrow("Cannot bind a prompt builder to a different provider.");
    });
  });

  describe("summary helper", () => {
    test("summary uses custom summarizer when over budget", async () => {
      const store = new InMemoryStore<StoredSummary>();
      const summarizer = () => "S";

      const builder = cria
        .prompt()
        .summary(cria.prompt().user("x".repeat(200)), {
          id: "conv-summary",
          store,
          summarize: summarizer,
          priority: 1,
        });

      const summaryOutput = "system: S";
      const fullOutput = `user: ${"x".repeat(200)}`;
      const budget =
        tokensFor(fullOutput) > tokensFor(summaryOutput)
          ? tokensFor(summaryOutput)
          : Math.max(0, tokensFor(fullOutput) - 1);

      const output = await builder.render({ provider, budget });

      expect(output).toBe(summaryOutput);
      const entry = store.get("conv-summary");
      expect(entry?.data.content).toBe("S");
    });
  });

  describe("content types", () => {
    test("truncate accepts raw PromptNode content", async () => {
      const inner: PromptNode = {
        kind: "message",
        role: "user",
        children: [{ type: "text", text: "element content" }],
      };
      const element = await cria
        .prompt()
        .truncate(inner, { budget: 100 })
        .build();

      const result = await render(element, {
        provider,
        budget: tokensFor("user: element content"),
      });
      expect(result).toBe("user: element content");
    });

    test("truncate accepts PromptBuilder content", async () => {
      const innerBuilder = cria.prompt().user("builder content");
      const element = await cria
        .prompt()
        .truncate(innerBuilder, { budget: 100 })
        .build();

      const result = await render(element, {
        provider,
        budget: tokensFor("user: builder content"),
      });
      expect(result).toBe("user: builder content");
    });
  });

  test("scope() works", async () => {
    const element = await cria
      .prompt()
      .scope((r) => r.user("Scoped content"))
      .build();

    const result = await render(element, {
      provider,
      budget: tokensFor("user: Scoped content"),
    });
    expect(result).toBe("user: Scoped content");
  });

  describe("vector search", () => {
    interface TestDocument {
      title: string;
      content: string;
    }

    function createMockVectorStore(
      results: { key: string; score: number; data: TestDocument }[]
    ) {
      return {
        get: () => null,
        set: () => {
          /* no-op */
        },
        delete: () => false,
        search: () =>
          results.map((r) => ({
            key: r.key,
            score: r.score,
            entry: {
              data: r.data,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          })),
      };
    }

    test("vectorSearch renders results at prompt level", async () => {
      const store = createMockVectorStore([
        {
          key: "doc-1",
          score: 0.95,
          data: { title: "Doc 1", content: "Content 1" },
        },
      ]);

      const result = await cria
        .prompt()
        .vectorSearch({
          store,
          query: "search query",
          limit: 1,
        })
        .render({ provider, budget: 10_000 });

      expect(result).toContain("user:");
      expect(result).toContain("score: 0.950");
      expect(result).toContain("Doc 1");
    });

    test("vectorSearch renders results inside message", async () => {
      const store = createMockVectorStore([
        {
          key: "doc-1",
          score: 0.9,
          data: { title: "Result", content: "Found it" },
        },
      ]);

      const result = await cria
        .prompt()
        .user((m) =>
          m.append("Here are the search results:\n").vectorSearch({
            store,
            query: "test query",
            limit: 1,
          })
        )
        .render({ provider, budget: 10_000 });

      expect(result).toContain("user:");
      expect(result).toContain("Here are the search results:");
      expect(result).toContain("Result");
    });

    test("vectorSearch handles empty results", async () => {
      const store = createMockVectorStore([]);

      const result = await cria
        .prompt()
        .vectorSearch({
          store,
          query: "no matches",
        })
        .render({ provider, budget: 10_000 });

      expect(result).toContain("Vector search returned no results");
    });

    test("vectorSearch uses custom formatter", async () => {
      const store = createMockVectorStore([
        { key: "doc-1", score: 0.9, data: { title: "A", content: "B" } },
        { key: "doc-2", score: 0.8, data: { title: "C", content: "D" } },
      ]);

      const result = await cria
        .prompt()
        .vectorSearch({
          store,
          query: "test",
          formatter: (results) => `Found ${results.length} documents`,
        })
        .render({ provider, budget: 10_000 });

      expect(result).toContain("Found 2 documents");
    });
  });
});
