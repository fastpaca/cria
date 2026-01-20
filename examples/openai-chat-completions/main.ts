import { cria, type Prompt } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const provider = createProvider(client, "gpt-4o-mini");

const systemRules = (): Prompt =>
  cria.prompt().system("You are a helpful assistant.");

const userRequest = (question: string): Prompt => cria.prompt().user(question);

const prompt = cria.merge(
  systemRules(),
  userRequest("Give me three bullet points about Berlin's history.")
);

async function main(): Promise<void> {
  const messages = await prompt.render({
    provider,
    budget: 2000,
  });

  console.log("=== Messages ===");
  console.log(JSON.stringify(messages, null, 2));
  console.log(`=== Token count: ${provider.countTokens(messages)} / 2000 ===`);

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
  });

  console.log("=== OpenAI Response ===");
  console.log(completion.choices[0]?.message?.content);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
