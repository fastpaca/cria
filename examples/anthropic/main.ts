import Anthropic from "@anthropic-ai/sdk";
import { cria, type Prompt } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/anthropic";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-haiku-4-5";
const provider = createProvider(client, MODEL);

const systemRules = (): Prompt =>
  cria.prompt().system("You are a concise assistant that answers directly.");

const userRequest = (question: string): Prompt => cria.prompt().user(question);

const prompt = cria.merge(
  systemRules(),
  userRequest("Summarize the history of Berlin in two sentences.")
);

async function main(): Promise<void> {
  const rendered = await prompt.render({
    provider,
    budget: 2000,
  });

  const { system, messages } = rendered;
  const totalTokens = provider.countTokens(rendered);

  console.log(`=== Token count: ${totalTokens} / 2000 ===`);

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
