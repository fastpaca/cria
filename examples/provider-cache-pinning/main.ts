import { cria } from "@fastpaca/cria";
import { OpenAIChatProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const provider = new OpenAIChatProvider(openai, "gpt-5-nano");

const pinnedPrefix = cria.prompt().system("You are a helpful assistant.").pin({
  id: "system",
  version: "v1",
  scopeKey: "tenant:acme",
  ttlSeconds: 3600,
});

const prompt = cria.prompt(provider).prefix(pinnedPrefix).user("Hello!");
const { messages, cache_id } = await prompt.render();
await openai.chat.completions.create({
  model: "gpt-5-nano",
  messages,
  ...(cache_id ? { prompt_cache_key: cache_id } : {}),
});
