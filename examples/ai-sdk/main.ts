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

const documentSections = (docs: typeof documents): Prompt =>
  docs.reduce((acc, doc, i) => {
    const section = cria
      .prompt()
      .message(
        "assistant",
        `Here are some reference documents:\n\n### ${doc.title}\n${doc.content}\n\n`,
        { id: `doc-${i}` }
      );
    return cria.merge(acc, section);
  }, cria.prompt());

const historySections = (history: typeof conversationHistory): Prompt =>
  history.reduce((acc, msg, i) => {
    const section = cria
      .prompt()
      .message(msg.role as "user" | "assistant", msg.content, {
        id: `msg-${i}`,
      });
    return cria.merge(acc, section);
  }, cria.prompt());

const systemRules = (text: string): Prompt => cria.prompt().system(text);

const withDocuments = (docs: typeof documents): Prompt =>
  cria.prompt().omit(documentSections(docs), { priority: 3, id: "documents" });

const withHistory = (history: typeof conversationHistory): Prompt =>
  cria.prompt().truncate(historySections(history), {
    budget: 500,
    from: "start",
    priority: 2,
    id: "history",
  });

const userRequest = (question: string): Prompt =>
  cria.prompt().user(question, { id: "question" });

const prompt = cria.merge(
  systemRules(systemPrompt),
  withDocuments(documents),
  withHistory(conversationHistory),
  userRequest(userQuestion)
);

// Render with a token budget using the AI SDK provider
const budget = 1000; // tokens
const messages = await prompt.render({ provider, budget });

console.log("=== Rendered Messages ===");
console.log(JSON.stringify(messages, null, 2));

// Token count from provider-owned tiktoken
const totalTokens = provider.countTokens(messages);
console.log(`\n=== Token count: ${totalTokens} / ${budget} ===\n`);

// Call OpenAI using Vercel AI SDK with structured messages
async function main() {
  const messagesForSend = await prompt.render({ provider, budget });

  const { text } = await generateText({
    model,
    messages: messagesForSend,
  });

  console.log("=== AI Response ===");
  console.log(text);
}

main().catch(console.error);
