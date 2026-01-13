import { cria, type Prompt } from "@fastpaca/cria";
import { chatCompletions } from "@fastpaca/cria/openai";
import OpenAI from "openai";
import { encoding_for_model } from "tiktoken";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const tokenizer = (text: string): number =>
  encoding_for_model("gpt-4o-mini").encode(text).length;

const systemRules = (): Prompt =>
  cria.prompt().system("You are a helpful assistant.");

const userRequest = (question: string): Prompt => cria.prompt().user(question);

const prompt = cria.merge(
  systemRules(),
  userRequest("Give me three bullet points about Berlin's history.")
);

async function main(): Promise<void> {
  const messages = await prompt.render({
    tokenizer,
    budget: 2000,
    renderer: chatCompletions,
  });

  console.log("=== Messages ===");
  console.log(JSON.stringify(messages, null, 2));

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
