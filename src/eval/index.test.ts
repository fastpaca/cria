import { getEncoding } from "js-tiktoken";
import { describe, expect, test } from "vitest";
import type { z } from "zod";
import { c, cria } from "../dsl";
import { createPlainTextRenderer } from "../testing/plaintext";
import { ModelProvider } from "../types";
import { createJudge } from "./index";

const renderer = createPlainTextRenderer({
  includeRolePrefix: true,
  joinMessagesWith: "\n\n",
});
const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

class MockProvider extends ModelProvider<string> {
  readonly renderer = renderer;
  private readonly completionValue: string;
  private readonly objectValue: unknown | undefined;

  constructor(completionValue: string, objectValue?: unknown) {
    super();
    this.completionValue = completionValue;
    this.objectValue = objectValue;
  }

  countTokens(rendered: string): number {
    return countText(rendered);
  }

  completion(): string {
    return this.completionValue;
  }

  object<T>(_: string, schema: z.ZodType<T>): T {
    return this.objectValue ? schema.parse(this.objectValue) : schema.parse({});
  }
}

function createMockProvider(opts: {
  completion?: string;
  object?: unknown;
}): ModelProvider<string> {
  return new MockProvider(opts.completion ?? "", opts.object);
}

describe("judge", () => {
  test("toPass succeeds when score >= threshold", async () => {
    const target = createMockProvider({ completion: "Hello!" });
    const evaluator = createMockProvider({
      object: { score: 0.9, reasoning: "Great" },
    });

    const prompt = await cria.prompt().user("Hi").build();

    const judge = createJudge({ target, evaluator });
    await expect(judge(prompt).toPass(c`Be friendly`)).resolves.toBeUndefined();
  });

  test("toPass throws when score < threshold", async () => {
    const target = createMockProvider({ completion: "Whatever." });
    const evaluator = createMockProvider({
      object: { score: 0.3, reasoning: "Not helpful" },
    });

    const prompt = await cria.prompt().user("Help me").build();

    const judge = createJudge({ target, evaluator, threshold: 0.8 });
    await expect(judge(prompt).toPass(c`Be helpful`)).rejects.toThrow(
      "Expected prompt to pass criterion"
    );
  });

  test("passes criterion to evaluator", async () => {
    let capturedPrompt = "";
    const target = createMockProvider({ completion: "Response" });
    const evaluator: ModelProvider<string> = new (class extends MockProvider {
      constructor() {
        super("");
      }

      object<T>(rendered: string, schema: z.ZodType<T>): T {
        capturedPrompt = rendered;
        return schema.parse({ score: 1, reasoning: "ok" });
      }
    })();

    const prompt = await cria.prompt().user("Test").build();

    const judge = createJudge({ target, evaluator });
    await judge(prompt).toPass(c`Check for politeness`);

    expect(capturedPrompt).toContain("politeness");
    expect(capturedPrompt).toContain("You are an evaluator");
  });
});
