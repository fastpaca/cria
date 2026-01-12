import { describe, expect, test } from "vitest";
import type { StoredSummary } from "./components/summary";
import { cria } from "./dsl";
import { InMemoryStore } from "./memory";

const tokenizer = (text: string): number => text.length;

describe("DSL Summary", () => {
  test("summary uses custom summarizer when over budget", async () => {
    const store = new InMemoryStore<StoredSummary>();
    const summarizer = () => "S";

    const builder = cria.prompt().summary("x".repeat(200), {
      id: "conv-summary",
      store,
      summarize: summarizer,
      priority: 1,
    });

    const output = await builder.render({ tokenizer, budget: 60 });

    expect(output).toBe("Assistant: [Summary of earlier conversation]\nS\n\n");
    const entry = store.get("conv-summary");
    expect(entry?.data.content).toBe("S");
    expect(entry?.data.tokenCount).toBe(1);
  });
});
