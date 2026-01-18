import { cria, type Prompt } from "@fastpaca/cria";
import { createResponsesProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const provider = createResponsesProvider(client, "gpt-4o-mini");

const systemRules = (): Prompt =>
  cria
    .prompt()
    .system("You are a helpful assistant that returns concise bullet lists.");

const userRequest = (question: string): Prompt => cria.prompt().user(question);

const prompt = cria.merge(
  systemRules(),
  userRequest("List three famous landmarks in Berlin.")
);

async function main(): Promise<void> {
  const inputItems = await prompt.render({
    provider,
    budget: 2000,
  });

  console.log("=== Response Input Items ===");
  console.log(JSON.stringify(inputItems, null, 2));
  console.log(
    `=== Token count: ${provider.countTokens(inputItems)} / 2000 ===`
  );

  const response = await client.responses.create({
    model: "gpt-4o-mini",
    input: inputItems,
  });

  console.log("=== OpenAI Response ===");
  console.log(response.output_text);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
