import { openai } from "@ai-sdk/openai";
import { cria, InMemoryStore, Last, type StoredSummary } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/ai-sdk";
import { generateText } from "ai";

const provider = createProvider(openai("gpt-4o-mini"));

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

const historyLines = conversationHistory.map(
  (msg) => `${msg.role.toUpperCase()}: ${msg.content}\n`
);

// Build the prompt with Summary for older messages and Last for recent ones
const prompt = cria.prompt().provider(provider, (p) =>
  p
    .system(
      "You are a helpful AI assistant. You have access to a summary of earlier conversation and the recent messages.",
      { priority: 0 }
    )
    .user((m) =>
      m
        .summary(historyLines.slice(0, -4), {
          id: "conversation-summary",
          store,
          priority: 2,
        })
        .raw(Last({ N: 4, children: historyLines }))
    )
);

// Render with a tight budget to trigger summarization
const budget = 240;
const messages = await prompt.render({
  provider,
  budget,
});

console.log("=== Rendered Messages ===");
console.log(JSON.stringify(messages, null, 2));

// Show stored summary
const storedEntry = store.get("conversation-summary");
if (storedEntry) {
  console.log("\n=== Stored Summary ===");
  console.log(storedEntry.data.content);
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
