import { expect, test } from "vitest";
import {
  InMemoryStore,
  Last,
  Region,
  render,
  type StoredSummary,
  Summary,
} from "../index";

// Simple tokenizer: 1 token per 4 characters
const tokenizer = (text: string): number => Math.ceil(text.length / 4);

test("Summary: triggers summarization when over budget", async () => {
  const store = new InMemoryStore<StoredSummary>();
  let summarizeCalled = false;

  const summarize = ({ content }: { content: string }) => {
    summarizeCalled = true;
    return `Summary of: ${content.slice(0, 20)}...`;
  };

  const longContent = "A".repeat(200);

  const element = Region({
    priority: 0,
    children: [
      Summary({
        id: "test-1",
        priority: 1,
        store,
        summarize,
        children: [longContent],
      }),
    ],
  });

  // Render with small budget to trigger summarization
  // Budget needs to fit the summary output + "[Summary of earlier conversation]\n" prefix
  const result = await render(element, { tokenizer, budget: 30 });

  expect(summarizeCalled).toBe(true);
  expect(result).toContain("Summary of:");
  expect(result.length).toBeLessThan(longContent.length);
});

test("Summary: stores summary in store", async () => {
  const store = new InMemoryStore<StoredSummary>();

  const summarize = () => "This is the summary";

  const element = Region({
    priority: 0,
    children: [
      Summary({
        id: "test-2",
        priority: 1,
        store,
        summarize,
        children: ["Long content ".repeat(50)],
      }),
    ],
  });

  await render(element, { tokenizer, budget: 20 });

  const entry = store.get("test-2");
  expect(entry).not.toBeNull();
  expect(entry?.data.content).toBe("This is the summary");
  expect(entry?.data.tokenCount).toBeGreaterThan(0);
  expect(entry?.updatedAt).toBeGreaterThan(0);
});

test("Summary: passes existing summary to summarizer", async () => {
  const store = new InMemoryStore<StoredSummary>();

  // Pre-populate store
  store.set("test-3", {
    content: "Previous summary",
    tokenCount: 10,
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

  const element = Region({
    priority: 0,
    children: [
      Summary({
        id: "test-3",
        priority: 1,
        store,
        summarize,
        children: ["Content ".repeat(100)],
      }),
    ],
  });

  await render(element, { tokenizer, budget: 20 });

  expect(receivedExisting).toBe("Previous summary");
});

test("Summary: does not trigger when under budget", async () => {
  const store = new InMemoryStore<StoredSummary>();
  let summarizeCalled = false;

  const summarize = () => {
    summarizeCalled = true;
    return "Summary";
  };

  const element = Region({
    priority: 0,
    children: [
      Summary({
        id: "test-4",
        priority: 1,
        store,
        summarize,
        children: ["Short"],
      }),
    ],
  });

  // Large budget - no need to summarize
  await render(element, { tokenizer, budget: 1000 });

  expect(summarizeCalled).toBe(false);
});

test("Last: keeps only last N children", async () => {
  const messages = ["First", "Second", "Third", "Fourth", "Fifth"];

  const element = Region({
    priority: 0,
    children: [Last({ N: 2, children: messages })],
  });

  const result = await render(element, { tokenizer, budget: 1000 });

  expect(result).not.toContain("First");
  expect(result).not.toContain("Second");
  expect(result).not.toContain("Third");
  expect(result).toContain("Fourth");
  expect(result).toContain("Fifth");
});

test("Last: handles N larger than children count", async () => {
  const messages = ["One", "Two"];

  const element = Region({
    priority: 0,
    children: [Last({ N: 10, children: messages })],
  });

  const result = await render(element, { tokenizer, budget: 1000 });

  expect(result).toContain("One");
  expect(result).toContain("Two");
});

test("Summary + Last: typical usage pattern", async () => {
  const store = new InMemoryStore<StoredSummary>();

  // Summarizer produces a short fixed-length output
  const summarize = () => "Discussed greetings";

  // Use longer messages so the summary provides real compression
  const messages = [
    "Message 1: Hello there, how are you doing today?",
    "Message 2: I am doing great, thanks for asking!",
    "Message 3: That is wonderful to hear from you.",
    "Message 4: Recent message here",
    "Message 5: Final message",
  ];

  const element = Region({
    priority: 0,
    children: [
      Summary({
        id: "conv",
        priority: 2,
        store,
        summarize,
        children: messages.slice(0, -2),
      }),
      Last({ N: 2, children: messages }),
    ],
  });

  // Full content: ~180 chars = 45 tokens
  // Summarized: prefix (34) + summary (19) + last 2 msgs (~50) = ~103 chars = 26 tokens
  const result = await render(element, { tokenizer, budget: 30 });

  // Should have summary of older messages (wrapped with prefix)
  expect(result).toContain("[Summary of earlier conversation]");
  expect(result).toContain("Discussed greetings");

  // Should have recent messages in full
  expect(result).toContain("Message 4: Recent message here");
  expect(result).toContain("Message 5: Final message");
});
