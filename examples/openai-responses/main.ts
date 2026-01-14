import { cria, type Prompt } from "@fastpaca/cria";
import { responses } from "@fastpaca/cria/openai";
import OpenAI from "openai";
import { encoding_for_model } from "tiktoken";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const enc = encoding_for_model("gpt-4o-mini");
const tokenizer = (text: string): number => enc.encode(text).length;

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
    tokenizer,
    budget: 2000,
    renderer: responses,
  });

  console.log("=== Response Input Items ===");
  console.log(JSON.stringify(inputItems, null, 2));

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
