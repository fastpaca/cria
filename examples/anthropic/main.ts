import Anthropic from "@anthropic-ai/sdk";
import { cria } from "@fastpaca/cria";
import { anthropic } from "@fastpaca/cria/anthropic";
import { get_encoding } from "tiktoken";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const enc = get_encoding("cl100k_base");
const tokenizer = (text: string): number => enc.encode(text).length;
const MODEL = "claude-haiku-4-5";

const prompt = cria
  .prompt()
  .system("You are a concise assistant that answers directly.")
  .user("Summarize the history of Berlin in two sentences.");

async function main(): Promise<void> {
  const rendered = await prompt.render({
    tokenizer,
    budget: 2000,
    renderer: anthropic,
  });

  const { system, messages } = rendered;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system,
    messages,
  });

  console.log("=== Anthropic Response ===");
  console.log(
    response.content[0]?.type === "text"
      ? response.content[0].text
      : response.content
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
