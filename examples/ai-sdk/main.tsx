import { openai } from "@ai-sdk/openai";
import { Message, Omit, Region, render, Truncate } from "@fastpaca/cria";
import { renderer } from "@fastpaca/cria/ai-sdk";
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

// Build the prompt using Cria JSX with Message components for structured output
const prompt = (
  <Region priority={0}>
    {/* System message - highest priority, never dropped */}
    {/* biome-ignore lint/a11y/useValidAriaRole: Cria's Message `role` prop is an LLM role, not an ARIA role. */}
    <Message id="system" priority={0} role="system">
      {systemPrompt}
    </Message>

    {/* Assistant message with reference documents - can be omitted if over budget */}
    <Omit id="documents" priority={3}>
      {/* biome-ignore lint/a11y/useValidAriaRole: Cria's Message `role` prop is an LLM role, not an ARIA role. */}
      <Message priority={3} role="assistant">
        {"Here are some reference documents:\n\n"}
        {documents.map((doc, i) => (
          <Region id={`doc-${i}`} priority={3}>
            {`### ${doc.title}\n${doc.content}\n\n`}
          </Region>
        ))}
      </Message>
    </Omit>

    {/* Conversation history - truncate from start if needed */}
    <Truncate budget={500} from="start" id="history" priority={2}>
      {conversationHistory.map((msg, i) => (
        <Message
          id={`msg-${i}`}
          priority={2}
          role={msg.role as "user" | "assistant"}
        >
          {msg.content}
        </Message>
      ))}
    </Truncate>

    {/* Current question - high priority */}
    {/* biome-ignore lint/a11y/useValidAriaRole: Cria's Message `role` prop is an LLM role, not an ARIA role. */}
    <Message id="question" priority={1} role="user">
      {userQuestion}
    </Message>
  </Region>
);

// Render with a token budget using the AI SDK renderer
const budget = 1000; // tokens
const messages = await render(prompt, {
  tokenizer,
  budget,
  renderer,
});

console.log("=== Rendered Messages ===");
console.log(JSON.stringify(messages, null, 2));

// Calculate approximate token count from messages
const messageText = messages
  .map((m) => {
    if (typeof m.content === "string") {
      return m.content;
    }
    return m.content
      .map((p) => {
        if ("text" in p) {
          return p.text;
        }
        return JSON.stringify(p);
      })
      .join("");
  })
  .join("\n");
console.log(
  `\n=== Approximate token count: ${tokenizer(messageText)} / ${budget} ===\n`
);

// Call OpenAI using Vercel AI SDK with structured messages
async function main() {
  const { text } = await generateText({
    model: openai("gpt-4o-mini"),
    messages,
  });

  console.log("=== AI Response ===");
  console.log(text);
}

main().catch(console.error);
