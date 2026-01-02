import { openai } from "@ai-sdk/openai";
import {
  Last,
  Message,
  memoryStore,
  Region,
  render,
  Summary,
} from "@fastpaca/cria";
import { renderer } from "@fastpaca/cria/ai-sdk";
import { generateText } from "ai";
import { encoding_for_model } from "tiktoken";

// Create a tokenizer using tiktoken (GPT-4 encoding)
const enc = encoding_for_model("gpt-4");
const tokenizer = (text: string): number => enc.encode(text).length;

// Create a persistent store for summaries
const store = memoryStore();

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

// The summarizer uses an LLM to create running summaries
const summarizer = async ({
  content,
  existingSummary,
}: {
  content: string;
  existingSummary: string | null;
}) => {
  const { text } = await generateText({
    model: openai("gpt-4o-mini"),
    messages: [
      {
        role: "system",
        content:
          "You are a conversation summarizer. Create a concise summary that captures the key information discussed. If there's an existing summary, build upon it with the new information.",
      },
      {
        role: "user",
        content: existingSummary
          ? `Existing summary:\n${existingSummary}\n\nNew conversation to incorporate:\n${content}\n\nCreate an updated summary:`
          : `Summarize this conversation:\n${content}`,
      },
    ],
  });
  return text;
};

// Build the prompt with Summary for older messages and Last for recent ones
const prompt = (
  <Region priority={0}>
    {/* biome-ignore lint/a11y/useValidAriaRole: LLM role, not ARIA */}
    <Message priority={0} role="system">
      You are a helpful AI assistant. You have access to a summary of earlier
      conversation and the recent messages.
    </Message>

    {/* Older messages get summarized when over budget */}
    <Summary
      id="conversation-summary"
      priority={2}
      store={store}
      summarize={summarizer}
    >
      {conversationHistory.slice(0, -4).map((msg, i) => (
        <Message
          id={`history-${i}`}
          priority={2}
          role={msg.role as "user" | "assistant"}
        >
          {msg.content}
        </Message>
      ))}
    </Summary>

    {/* Recent messages kept in full */}
    <Last N={4}>
      {conversationHistory.map((msg, i) => (
        <Message
          id={`recent-${i}`}
          priority={1}
          role={msg.role as "user" | "assistant"}
        >
          {msg.content}
        </Message>
      ))}
    </Last>
  </Region>
);

// Render with a tight budget to trigger summarization
const budget = 300; // Small budget to force summarization
const messages = await render(prompt, {
  tokenizer,
  budget,
  renderer,
});

console.log("=== Rendered Messages ===");
console.log(JSON.stringify(messages, null, 2));

// Show stored summary
const storedSummary = await store.get("conversation-summary");
if (storedSummary) {
  console.log("\n=== Stored Summary ===");
  console.log(storedSummary.content);
  console.log(`Token count: ${storedSummary.tokenCount}`);
}

// Call OpenAI
async function main() {
  const { text } = await generateText({
    model: openai("gpt-4o-mini"),
    messages,
  });

  console.log("\n=== AI Response ===");
  console.log(text);
}

main().catch(console.error);
