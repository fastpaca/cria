import { openai } from "@ai-sdk/openai";
import { Omit, Region, render, Truncate } from "@fastpaca/cria";
import { generateText } from "ai";
import { encoding_for_model } from "tiktoken";

// Create a tokenizer using tiktoken (GPT-4 encoding)
const enc = encoding_for_model("gpt-4");
const tokenizer = (text: string): number => enc.encode(text).length;

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

// Build the prompt using Cria JSX
const prompt = (
  <Region priority={0}>
    {/* System prompt - highest priority, never dropped */}
    <Region id="system" priority={0}>
      {systemPrompt}
      {"\n\n"}
    </Region>

    {/* Documents - can be omitted if over budget */}
    <Omit id="documents" priority={3}>
      {"## Reference Documents\n\n"}
      {documents.map((doc, i) => (
        <Region id={`doc-${i}`} priority={3}>
          {`### ${doc.title}\n${doc.content}\n\n`}
        </Region>
      ))}
    </Omit>

    {/* Conversation history - truncate from start if needed */}
    <Truncate budget={500} from="start" id="history" priority={2}>
      {"## Conversation History\n\n"}
      {conversationHistory.map((msg, i) => (
        <Region id={`msg-${i}`} priority={2}>
          {`${msg.role}: ${msg.content}\n`}
        </Region>
      ))}
      {"\n"}
    </Truncate>

    {/* Current question - high priority */}
    <Region id="question" priority={1}>
      {"## Current Question\n\n"}
      {`user: ${userQuestion}`}
    </Region>
  </Region>
);

// Render with a token budget
const budget = 1000; // tokens
const renderedPrompt = render(prompt, { tokenizer, budget });

console.log("=== Rendered Prompt ===");
console.log(renderedPrompt);
console.log(
  `\n=== Token count: ${tokenizer(renderedPrompt)} / ${budget} ===\n`
);

// Call OpenAI using Vercel AI SDK
async function main() {
  const { text } = await generateText({
    model: openai("gpt-4o-mini"),
    prompt: renderedPrompt,
  });

  console.log("=== AI Response ===");
  console.log(text);
}

main().catch(console.error);
