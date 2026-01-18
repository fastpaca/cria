import { openai } from "@ai-sdk/openai";
import { cria, type Prompt } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/ai-sdk";
import { generateText } from "ai";

const model = openai("gpt-4o-mini");
const provider = createProvider(model);

// Example data
const systemPrompt = "You are a helpful AI assistant. Be concise and direct.";

const conversationHistory = [
  { role: "user", content: "What's the capital of France?" },
  { role: "assistant", content: "Paris is the capital of France." },
  { role: "user", content: "What about Germany?" },
  { role: "assistant", content: "Berlin is the capital of Germany." },
  { role: "user", content: "And what's the population of Berlin?" },
];

const documents = [
  {
    title: "Berlin Facts",
    content:
      "Berlin has a population of approximately 3.7 million people as of 2023. It is the largest city in Germany and the European Union by population within city limits.",
  },
  {
    title: "German Geography",
    content:
      "Germany is located in Central Europe and shares borders with nine countries. It has a diverse landscape including the Alps, the Black Forest, and the North Sea coast.",
  },
];

const userQuestion = "Can you summarize Berlin's key facts?";

// Build the prompt using the DSL for structured output
const documentSections: Prompt = documents.reduce(
  (acc, doc, i) =>
    acc.merge(
      cria
        .prompt()
        .message(
          "assistant",
          `Here are some reference documents:\n\n### ${doc.title}\n${doc.content}\n\n`,
          { priority: 3, id: `doc-${i}` }
        )
    ),
  cria.prompt()
);

const historySection: Prompt = conversationHistory.reduce(
  (acc, msg, i) =>
    acc.merge(
      cria.prompt().message(msg.role as "user" | "assistant", msg.content, {
        priority: 2,
        id: `msg-${i}`,
      })
    ),
  cria.prompt()
);

const prompt = cria
  .prompt()
  // System message - highest priority, never dropped
  .system(systemPrompt, { priority: 0 })
  // Assistant message with reference documents - can be omitted if over budget
  .omit(documentSections, { priority: 3, id: "documents" })
  // Conversation history - truncate from start if needed
  .truncate(historySection, {
    budget: 500,
    from: "start",
    priority: 2,
    id: "history",
  })
  // Current question - high priority
  .user(userQuestion, { priority: 1, id: "question" });

// Render with a token budget using the AI SDK provider
const budget = 1000; // tokens
const messages = await prompt.render({
  provider,
  budget,
});

console.log("=== Rendered Messages ===");
console.log(JSON.stringify(messages, null, 2));
console.log(
  `\n=== Token count: ${provider.countTokens(messages)} / ${budget} ===\n`
);

// Call OpenAI using Vercel AI SDK with structured messages
async function main() {
  const { text } = await generateText({
    model,
    messages,
  });

  console.log("=== AI Response ===");
  console.log(text);
}

main().catch(console.error);
