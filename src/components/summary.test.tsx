import { expect, test } from "vitest";
import { Last, memoryStore, Region, render, Summary } from "../index";

// Simple tokenizer: 1 token per 4 characters
const tokenizer = (text: string): number => Math.ceil(text.length / 4);

test("Summary: triggers summarization when over budget", async () => {
  const store = memoryStore();
  let summarizeCalled = false;

  const summarize = ({ content }: { content: string }) => {
    summarizeCalled = true;
    return `Summary of: ${content.slice(0, 20)}...`;
  };

  const longContent = "A".repeat(200);

  const element = (
    <Region priority={0}>
      <Summary id="test-1" priority={1} store={store} summarize={summarize}>
        {longContent}
      </Summary>
    </Region>
  );

  // Render with small budget to trigger summarization
  const result = await render(element, { tokenizer, budget: 20 });

  expect(summarizeCalled).toBe(true);
  expect(result).toContain("Summary of:");
  expect(result.length).toBeLessThan(longContent.length);
});

test("Summary: stores summary in store", async () => {
  const store = memoryStore();

  const summarize = () => "This is the summary";

  const element = (
    <Region priority={0}>
      <Summary id="test-2" priority={1} store={store} summarize={summarize}>
        {"Long content ".repeat(50)}
      </Summary>
    </Region>
  );

  await render(element, { tokenizer, budget: 20 });

  const stored = await store.get("test-2");
  expect(stored).not.toBeNull();
  expect(stored?.content).toBe("This is the summary");
  expect(stored?.tokenCount).toBeGreaterThan(0);
  expect(stored?.lastUpdated).toBeGreaterThan(0);
});

test("Summary: passes existing summary to summarizer", async () => {
  const store = memoryStore();

  // Pre-populate store
  await store.set("test-3", {
    content: "Previous summary",
    tokenCount: 10,
    lastUpdated: Date.now(),
  });

  let receivedExisting: string | null = null;

  const summarize = ({
    existingSummary,
  }: {
    content: string;
    existingSummary: string | null;
  }) => {
    receivedExisting = existingSummary;
    return "Updated summary";
  };

  const element = (
    <Region priority={0}>
      <Summary id="test-3" priority={1} store={store} summarize={summarize}>
        {"Content ".repeat(100)}
      </Summary>
    </Region>
  );

  await render(element, { tokenizer, budget: 20 });

  expect(receivedExisting).toBe("Previous summary");
});

test("Summary: does not trigger when under budget", async () => {
  const store = memoryStore();
  let summarizeCalled = false;

  const summarize = () => {
    summarizeCalled = true;
    return "Summary";
  };

  const element = (
    <Region priority={0}>
      <Summary id="test-4" priority={1} store={store} summarize={summarize}>
        Short
      </Summary>
    </Region>
  );

  // Large budget - no need to summarize
  await render(element, { tokenizer, budget: 1000 });

  expect(summarizeCalled).toBe(false);
});

test("Last: keeps only last N children", async () => {
  const messages = ["First", "Second", "Third", "Fourth", "Fifth"];

  const element = (
    <Region priority={0}>
      <Last N={2}>{messages}</Last>
    </Region>
  );

  const result = await render(element, { tokenizer, budget: 1000 });

  expect(result).not.toContain("First");
  expect(result).not.toContain("Second");
  expect(result).not.toContain("Third");
  expect(result).toContain("Fourth");
  expect(result).toContain("Fifth");
});

test("Last: handles N larger than children count", async () => {
  const messages = ["One", "Two"];

  const element = (
    <Region priority={0}>
      <Last N={10}>{messages}</Last>
    </Region>
  );

  const result = await render(element, { tokenizer, budget: 1000 });

  expect(result).toContain("One");
  expect(result).toContain("Two");
});

test("memoryStore: basic get/set operations", async () => {
  const store = memoryStore();

  expect(await store.get("nonexistent")).toBeNull();

  const summary = {
    content: "Test summary",
    tokenCount: 5,
    lastUpdated: Date.now(),
  };

  await store.set("key1", summary);

  const retrieved = await store.get("key1");
  expect(retrieved).toEqual(summary);
});

test("Summary + Last: typical usage pattern", async () => {
  const store = memoryStore();

  const summarize = ({ content }: { content: string }) => {
    return `[Summary: ${content.length} chars]`;
  };

  const messages = [
    "Message 1: Hello",
    "Message 2: How are you?",
    "Message 3: Fine thanks",
    "Message 4: Great!",
    "Message 5: Goodbye",
  ];

  const element = (
    <Region priority={0}>
      <Summary id="conv" priority={2} store={store} summarize={summarize}>
        {messages.slice(0, -2)}
      </Summary>
      <Last N={2}>{messages}</Last>
    </Region>
  );

  // Small budget forces summarization
  const result = await render(element, { tokenizer, budget: 15 });

  // Should have summary of older messages
  expect(result).toContain("[Summary:");

  // Should have recent messages in full
  expect(result).toContain("Message 4: Great!");
  expect(result).toContain("Message 5: Goodbye");
});
