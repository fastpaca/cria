import { cria, type StoredSummary } from "@fastpaca/cria";
import { InMemoryStore, type KVMemory } from "@fastpaca/cria/memory";
import type { ProviderRenderContext } from "@fastpaca/cria/provider";
import { describe, expect, test } from "vitest";
import {
  createFixedCompletionProvider,
  createPlainTextCodec,
  PlainTextProvider,
} from "../utils/plaintext";

const renderProvider = createFixedCompletionProvider("S", {
  includeRolePrefix: true,
  joinMessagesWith: "\n\n",
});
const summaryProvider = createFixedCompletionProvider("S", {
  includeRolePrefix: true,
  joinMessagesWith: "\n\n",
});
const tokensFor = (text: string): number => renderProvider.countTokens(text);

class RecordingSummaryProvider extends PlainTextProvider {
  private readonly completionText: string;
  lastRendered: string | null = null;

  constructor(completionText: string) {
    super(
      createPlainTextCodec({
        includeRolePrefix: true,
        joinMessagesWith: "\n\n",
      })
    );
    this.completionText = completionText;
  }

  override completion(
    rendered: string,
    _context?: ProviderRenderContext
  ): string {
    this.lastRendered = rendered;
    return this.completionText;
  }
}

describe("summary helper", () => {
  test("summary writes when over budget", async () => {
    const store = new InMemoryStore<StoredSummary>();

    const summary = cria
      .summarizer({
        id: "conv-summary",
        store,
        priority: 1,
        provider: summaryProvider,
      })
      .plugin({ history: cria.prompt().user("x".repeat(200)) });

    const builder = cria.prompt().use(summary);

    const summaryOutput = "system: S";
    const fullOutput = `user: ${"x".repeat(200)}`;
    const budget =
      tokensFor(fullOutput) > tokensFor(summaryOutput)
        ? tokensFor(summaryOutput)
        : Math.max(0, tokensFor(fullOutput) - 1);

    const output = await builder.render({ provider: renderProvider, budget });

    expect(output).toBe(summaryOutput);
    const entry = store.get("conv-summary");
    expect(entry?.data.content).toBe("S");
  });

  test("summary does not write when under budget", async () => {
    const store = new InMemoryStore<StoredSummary>();

    const summary = cria
      .summarizer({
        id: "conv-under-budget",
        store,
        provider: summaryProvider,
      })
      .plugin({ history: cria.prompt().user("brief history") });

    const fullOutput = "user: brief history";
    const output = await cria
      .prompt()
      .use(summary)
      .render({ provider: renderProvider, budget: tokensFor(fullOutput) + 10 });

    expect(output).toBe(fullOutput);
    expect(store.get("conv-under-budget")).toBeNull();
  });

  test("summary update includes existing summary and update instruction", async () => {
    const store = new InMemoryStore<StoredSummary>();
    store.set("conv-existing", { content: "previous summary" });
    const provider = new RecordingSummaryProvider("updated");

    const summary = cria.summarizer({
      id: "conv-existing",
      store,
      provider,
    });

    const output = await summary.writeNow({
      history: cria.prompt().user("new detail"),
    });

    expect(output).toBe("updated");
    expect(provider.lastRendered).toContain("assistant: Current summary:");
    expect(provider.lastRendered).toContain("previous summary");
    expect(provider.lastRendered).toContain(
      "Update the summary based on the previous summary and the conversation above."
    );
    expect(provider.lastRendered).toContain("user: new detail");
  });

  test("summary supports inputLayout history", async () => {
    const store = new InMemoryStore<StoredSummary>();
    const summary = cria
      .summarizer({
        id: "conv-input-layout",
        store,
        provider: summaryProvider,
      })
      .plugin({
        history: cria.inputLayout([
          { role: "system", text: "Prior context" },
          { role: "user", text: "Question" },
        ]),
      });

    const summaryOutput = "system: S";
    const fullOutput = "system: Prior context\n\nuser: Question";
    const budget =
      tokensFor(fullOutput) > tokensFor(summaryOutput)
        ? tokensFor(summaryOutput)
        : Math.max(0, tokensFor(fullOutput) - 1);

    const output = await cria
      .prompt()
      .use(summary)
      .render({ provider: renderProvider, budget });

    expect(output).toBe(summaryOutput);
    expect(store.get("conv-input-layout")?.data.content).toBe("S");
  });

  test("load validates stored summary shape", async () => {
    const store: KVMemory<StoredSummary> = {
      get: async () => ({
        data: { content: 42 } as unknown as StoredSummary,
        createdAt: 0,
        updatedAt: 0,
      }),
      set: async () => undefined,
      delete: async () => true,
    };
    const summary = cria.summarizer({
      id: "conv-invalid",
      store,
      provider: summaryProvider,
    });

    await expect(summary.load()).rejects.toThrow();
  });
});
