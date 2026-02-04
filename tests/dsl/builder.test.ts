import {
  c,
  cria,
  PromptBuilder,
  prompt,
  type StoredSummary,
  Summary,
} from "@fastpaca/cria";
import { InMemoryStore } from "@fastpaca/cria/memory";
import {
  ListMessageCodec,
  ModelProvider,
  type ProviderRenderContext,
} from "@fastpaca/cria/provider";
import { render } from "@fastpaca/cria/render";
import type {
  PromptLayout,
  PromptMessage,
  PromptMessageNode,
  PromptNode,
} from "@fastpaca/cria/types";
import { describe, expect, test } from "vitest";
import type { ZodType } from "zod";
import { createTestProvider } from "../utils/plaintext";

const provider = createTestProvider({
  includeRolePrefix: true,
  joinMessagesWith: "\n\n",
});
const tokensFor = (text: string): number => provider.countTokens(text);

const renderBuilder = async (
  builder: PromptBuilder<unknown, "unpinned" | "pinned">,
  budget = 10_000
): Promise<string> => render(await builder.build(), { provider, budget });

interface FakeToolIO {
  callInput: string;
  resultOutput: string;
}

interface FakeInputMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

class FakeInputCodec extends ListMessageCodec<FakeInputMessage, FakeToolIO> {
  protected toProviderMessage(args: {
    message: PromptMessage<FakeToolIO>;
    index: number;
    context?: ProviderRenderContext;
  }): readonly FakeInputMessage[] {
    const { message } = args;
    if (message.role === "tool") {
      return [];
    }
    return [{ role: message.role, content: message.text }];
  }

  protected fromProviderMessage(
    message: FakeInputMessage
  ): readonly PromptMessage<FakeToolIO>[] {
    return [{ role: message.role, text: message.content }];
  }
}

class FakeInputProvider extends ModelProvider<FakeInputMessage[], FakeToolIO> {
  readonly codec = new FakeInputCodec();

  countTokens(rendered: FakeInputMessage[]): number {
    return rendered.reduce(
      (total, message) => total + message.content.length,
      0
    );
  }

  completion(
    _rendered: FakeInputMessage[],
    _context?: ProviderRenderContext
  ): string {
    return "";
  }

  object<T>(
    _rendered: FakeInputMessage[],
    _schema: ZodType<T>,
    _context?: ProviderRenderContext
  ): never {
    throw new Error("Not implemented");
  }
}

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
        cria
          .prompt()
          .user((m) => m.append(c`Hello ` as unknown as string).append("World"))
      );

      expect(result).toBe("user: Hello World");
    });
  });

  describe("input", () => {
    test("inputLayout() appends PromptLayout messages", async () => {
      const layout: PromptLayout = [
        { role: "system", text: "System history." },
        { role: "user", text: "User history." },
      ];

      const result = await renderBuilder(cria.prompt().inputLayout(layout));

      expect(result).toBe("system: System history.\n\nuser: User history.");
    });

    test("input() accepts provider-native inputs", async () => {
      const provider = new FakeInputProvider();
      const input: FakeInputMessage[] = [
        { role: "system", content: "System history." },
        { role: "user", content: "User history." },
      ];

      const output = await cria
        .prompt(provider)
        .input(input)
        .render({ budget: 1000 });

      expect(output).toEqual(input);
    });

    test("summary accepts provider-native inputs", async () => {
      const provider = new FakeInputProvider();
      const store = new InMemoryStore<StoredSummary>();
      const input: FakeInputMessage[] = [
        { role: "system", content: "System history." },
        { role: "user", content: "User history." },
      ];

      const summary = new Summary({
        id: "history",
        store,
        priority: 1,
        provider,
      }).extend(cria.input(input));

      const output = await cria
        .prompt(provider)
        .use(summary)
        .render({ budget: 1000 });

      expect(output).toEqual(input);
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
      const custom: PromptMessageNode = {
        kind: "message",
        role: "user",
        children: [{ type: "text", text: "Custom content" }],
      };

      // @ts-expect-error - Type system limitation: PromptMessageNode<ProviderToolIO> vs PromptNode<UnboundToolIO>
      // Runtime is safe since we're only using text parts
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

  describe("content types", () => {
    test("truncate accepts raw PromptNode content", async () => {
      const inner: PromptMessageNode = {
        kind: "message",
        role: "user",
        children: [{ type: "text", text: "element content" }],
      };
      // Type system limitation: PromptMessageNode<ProviderToolIO> vs ScopeContent<UnboundToolIO>
      // Runtime is safe since we're only using text parts
      const element = await cria
        .prompt()
        // @ts-expect-error - Type mismatch between ProviderToolIO and UnboundToolIO
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
});
