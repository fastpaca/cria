import { cria } from "@fastpaca/cria";
import { OpenAIChatProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const provider = new OpenAIChatProvider(
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  "gpt-5-nano"
);

const pinnedPrefix = cria.prompt().system("You are a helpful assistant.").pin({
  id: "system",
  version: "v1",
  scopeKey: "tenant:acme",
  ttlSeconds: 3600,
});

const prompt = cria.prompt(provider).prefix(pinnedPrefix).user("Hello!");
const { output, context } = await prompt.renderWithContext();
await provider.completion(output, context);
