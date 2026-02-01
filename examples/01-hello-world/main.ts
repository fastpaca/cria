/**
 * Hello World - minimal cria example
 */

import { cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const client = new OpenAI();
const provider = createProvider(client, "gpt-4o-mini");

const { messages } = await cria
  .prompt(provider)
  .system("You are helpful.")
  .user("What is 2+2?")
  .render({ budget: 500 });

const response = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
});

console.log(response.choices[0]?.message?.content);
