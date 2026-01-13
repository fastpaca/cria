import { openai } from "@ai-sdk/openai";
import {
  cria,
  InMemoryStore,
  type Prompt,
  type StoredSummary,
} from "@fastpaca/cria";
import { Provider, renderer } from "@fastpaca/cria/ai-sdk";
import { generateText } from "ai";
import { encoding_for_model } from "tiktoken";

// Create a tokenizer using tiktoken (GPT-4 encoding)
const enc = encoding_for_model("gpt-4");
const tokenizer = (text: string): number => enc.encode(text).length;

// Create a persistent store for summaries
const store = new InMemoryStore<StoredSummary>();

// Simulated conversation history (imagine this grows over time)
const conversationHistory = [
  { role: "user", content: "What's the capital of France?" },
  { role: "assistant", content: "Paris is the capital of France." },
  { role: "user", content: "Tell me more about Paris." },
  {
    role: "assistant",
    content:
      "Paris is the capital and largest city of France. It's known for the Eiffel Tower, the Louvre Museum, Notre-Dame Cathedral, and its rich cultural heritage. The city is also famous for its cuisine, fashion, and art scene.",
  },
  { role: "user", content: "What about the population?" },
  {
    role: "assistant",
    content:
      "The city of Paris has a population of about 2.1 million people. The greater Paris metropolitan area, known as Île-de-France, has over 12 million inhabitants, making it one of the largest urban areas in Europe.",
  },
  { role: "user", content: "What's the weather like?" },
  {
    role: "assistant",
    content:
      "Paris has an oceanic climate with mild winters and warm summers. Average temperatures range from 3°C (37°F) in January to 20°C (68°F) in July. The city receives moderate rainfall throughout the year.",
  },
  { role: "user", content: "What are the best times to visit?" },
  {
    role: "assistant",
    content:
      "The best times to visit Paris are during spring (April-June) and fall (September-November). These seasons offer pleasant weather, fewer crowds than summer, and beautiful scenery with blooming flowers or autumn colors.",
  },
  { role: "user", content: "Now tell me about Berlin." },
];

const provider = new Provider(openai("gpt-4o-mini"));

const historyBuilder: Prompt = conversationHistory.slice(0, -4).reduce(
  (acc, msg, i) =>
    acc.merge(
      cria.prompt().message(msg.role as "user" | "assistant", msg.content, {
        priority: 2,
        id: `history-${i}`,
      })
    ),
  cria.prompt()
);

const recentBuilder: Prompt = conversationHistory.reduce(
  (acc, msg, i) =>
    acc.merge(
      cria.prompt().message(msg.role as "user" | "assistant", msg.content, {
        priority: 1,
        id: `recent-${i}`,
      })
    ),
  cria.prompt()
);

// Build the prompt with Summary for older messages and Last for recent ones
const prompt = cria.prompt().provider(provider, (p) =>
  p
    .system(
      "You are a helpful AI assistant. You have access to a summary of earlier conversation and the recent messages.",
      { priority: 0 }
    )
    // Older messages get summarized when over budget - no summarize prop needed!
    .summary(historyBuilder, {
      id: "conversation-summary",
      store,
      priority: 2,
    })
    // Recent messages kept in full
    .last(recentBuilder, { N: 4, priority: 1 })
);

// Render with a tight budget to trigger summarization
const budget = 240; // Budget that triggers summarization (full content ~243 tokens)
const messages = await prompt.render({
  tokenizer,
  budget,
  renderer,
});

console.log("=== Rendered Messages ===");
console.log(JSON.stringify(messages, null, 2));

// Show stored summary
const storedEntry = store.get("conversation-summary");
if (storedEntry) {
  console.log("\n=== Stored Summary ===");
  console.log(storedEntry.data.content);
  console.log(`Token count: ${storedEntry.data.tokenCount}`);
}

async function main() {
  const { text } = await generateText({
    model: openai("gpt-4o-mini"),
    messages,
  });

  console.log("\n=== AI Response ===");
  console.log(text);
}

main().catch(console.error);
