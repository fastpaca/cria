/**
 * Summary with SQLite - progressive summarization with local cache
 *
 * Requires: OPENAI_API_KEY
 */

import { cria, type StoredSummary } from "@fastpaca/cria";
import { SqliteStore } from "@fastpaca/cria/memory/sqlite";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("Missing OPENAI_API_KEY.");
}

const client = new OpenAI({ apiKey });
const provider = createProvider(client, "gpt-4o-mini");

const history = cria
  .prompt()
  .user("I'm planning a trip to Berlin.")
  .assistant("Great choice! Berlin is packed with history and culture.")
  .user("What neighborhoods should I stay in?")
  .assistant("Prenzlauer Berg and Kreuzberg are popular.");

const store = new SqliteStore<StoredSummary>({ filename: "cria.sqlite" });

const summarizer = cria.summarizer({
  id: "travel-chat",
  store,
  priority: 2,
  provider,
});

const summary = summarizer({ history });

const prompt = cria
  .prompt(provider)
  .system("You are a helpful travel assistant.")
  .use(summary)
  .user("Plan a one-day itinerary.");

const { messages } = await prompt.render({ budget: 300 });
const response = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
});

console.log(response.choices[0]?.message?.content);
