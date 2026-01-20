import { describe, expect, test } from "vitest";
import { InMemoryStore } from "../memory";
import { createTestProvider } from "../testing/plaintext";
import { cria } from "./index";
import type { StoredSummary } from "./summary";

const provider = createTestProvider({
  includeRolePrefix: true,
  joinMessagesWith: "\n\n",
});
const tokensFor = (text: string): number => provider.countTokens(text);

describe("summary helper", () => {
  test("summary uses custom summarizer when over budget", async () => {
    const store = new InMemoryStore<StoredSummary>();
    const summarizer = () => "S";

    const builder = cria.prompt().summary(cria.prompt().user("x".repeat(200)), {
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
