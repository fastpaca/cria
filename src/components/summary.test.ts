import { expect, test } from "vitest";
import {
  InMemoryStore,
  Last,
  Message,
  render,
  type StoredSummary,
  type SummarizerContext,
  Summary,
} from "../index";
import { createTestProvider } from "../testing/plaintext";

const provider = createTestProvider();
const tokensFor = (text: string): number => provider.countTokens(text);

test("Summary: triggers summarization when over budget", async () => {
  const store = new InMemoryStore<StoredSummary>();
  let summarizeCalled = false;

  const summarize = () => {
    summarizeCalled = true;
    return "Summary result";
  };

  const longContent = "A".repeat(200);

  const element = Message({
    messageRole: "assistant",
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

  const result = await render(element, {
    provider,
    budget: tokensFor("[Summary of earlier conversation]\nSummary result"),
  });

  expect(summarizeCalled).toBe(true);
  expect(result).toBe("[Summary of earlier conversation]\nSummary result");
});

test("Summary: stores summary in store", async () => {
  const store = new InMemoryStore<StoredSummary>();

  const summarize = () => "This is the summary";

  const element = Message({
    messageRole: "assistant",
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

  const output = await render(element, {
    provider,
    budget: tokensFor("[Summary of earlier conversation]\nThis is the summary"),
  });

  expect(output).toBe("[Summary of earlier conversation]\nThis is the summary");

  const entry = store.get("test-2");
  expect(entry).not.toBeNull();
  expect(entry?.data.content).toBe("This is the summary");
  expect(entry?.updatedAt).toBeGreaterThan(0);
});

test("Summary: passes existing summary to summarizer", async () => {
  const store = new InMemoryStore<StoredSummary>();

  store.set("test-3", {
    content: "Previous summary",
  });

  let receivedExisting: string | null = null;

  const summarize = ({ existingSummary }: SummarizerContext) => {
    receivedExisting = existingSummary;
    return "Updated summary";
  };

  const element = Message({
    messageRole: "assistant",
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

  const output = await render(element, {
    provider,
    budget: tokensFor("[Summary of earlier conversation]\nUpdated summary"),
  });

  expect(receivedExisting).toBe("Previous summary");
  expect(output).toBe("[Summary of earlier conversation]\nUpdated summary");
});

test("Summary: does not trigger when under budget", async () => {
  const store = new InMemoryStore<StoredSummary>();
  let summarizeCalled = false;

  const summarize = () => {
    summarizeCalled = true;
    return "Summary";
  };

  const element = Message({
    messageRole: "assistant",
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

  const output = await render(element, {
    provider,
    budget: tokensFor("Short"),
  });

  expect(summarizeCalled).toBe(false);
  expect(output).toBe("Short");
});

test("Last: keeps only last N children", async () => {
  const messages = ["First", "Second", "Third", "Fourth", "Fifth"];

  const element = Message({
    messageRole: "user",
    children: [Last({ N: 2, children: messages })],
  });

  const result = await render(element, {
    provider,
    budget: tokensFor("FourthFifth"),
  });

  expect(result).toBe("FourthFifth");
});

test("Last: handles N larger than children count", async () => {
  const messages = ["One", "Two"];

  const element = Message({
    messageRole: "user",
    children: [Last({ N: 10, children: messages })],
  });

  const result = await render(element, {
    provider,
    budget: tokensFor("OneTwo"),
  });

  expect(result).toBe("OneTwo");
});

test("Summary + Last: typical usage pattern", async () => {
  const store = new InMemoryStore<StoredSummary>();

  const summarize = () => "Discussed greetings";

  const messages = [
    "Message 1: Hello there, how are you doing today?",
    "Message 2: I am doing great, thanks for asking!",
    "Message 3: That is wonderful to hear from you.",
    "Message 4: Recent message here",
    "Message 5: Final message",
  ];

  const element = Message({
    messageRole: "assistant",
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

  const result = await render(element, {
    provider,
    budget: tokensFor(
      "[Summary of earlier conversation]\nDiscussed greetingsMessage 4: Recent message hereMessage 5: Final message"
    ),
  });

  expect(result).toBe(
    "[Summary of earlier conversation]\nDiscussed greetingsMessage 4: Recent message hereMessage 5: Final message"
  );
});
