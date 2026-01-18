/** Minimal optional JSX example using the Cria JSX runtime. */
import { render } from "@fastpaca/cria";
import { Message, Region } from "@fastpaca/cria/jsx";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const prompt = (
  <Region priority={0}>
    <Message messageRole="system">You are a friendly assistant.</Message>
    <Message messageRole="user">Say hello to the user.</Message>
  </Region>
);

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const provider = createProvider(client, "gpt-4o-mini");

async function main(): Promise<void> {
  const output = await render(prompt, { provider, budget: 100 });
  console.log(JSON.stringify(output, null, 2));
}

main().catch(console.error);
