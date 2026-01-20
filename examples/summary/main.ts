import {
  cria,
  InMemoryStore,
  type Prompt,
  type StoredSummary,
} from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const provider = createProvider(client, "gpt-4o-mini");
const store = new InMemoryStore<StoredSummary>();

const conversation = [
  "USER: I'm planning a trip to Berlin. What neighborhoods should I stay in?",
  "ASSISTANT: Prenzlauer Berg and Kreuzberg are great for food and nightlife.",
  "USER: What are the must-see historical sites?",
  "ASSISTANT: Brandenburg Gate, the Berlin Wall memorial, and Museum Island.",
  "USER: Give me a short summary and a restaurant recommendation.",
];

const recentTurns = conversation.slice(-2).join("\n");
const fullHistory = conversation.join("\n");

const systemRules = (): Prompt =>
  cria
    .prompt()
    .system(
      "You summarize long conversations and keep the last 2 turns verbatim."
    );

const summaryBlock = (): Prompt =>
  cria.prompt().summary(cria.prompt().user(fullHistory), {
    id: "running-summary",
    store,
    priority: 2,
  });

const recentHistory = (): Prompt =>
  cria.prompt().truncate(cria.prompt().user(recentTurns), {
    budget: 200,
    from: "start",
    priority: 1,
  });

const userRequest = (question: string): Prompt => cria.prompt().user(question);

const prompt = cria.merge(
  systemRules(),
  summaryBlock(),
  recentHistory(),
  userRequest(
    "Summarize the conversation so far and suggest a 1-day itinerary."
  )
);

async function main(): Promise<void> {
  const messages = await prompt.render({
    provider,
    budget: 800,
  });

  console.log("=== Rendered messages ===");
  console.log(JSON.stringify(messages, null, 2));
  console.log(`=== Token count: ${provider.countTokens(messages)} / 800 ===`);

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
  });

  console.log("\n=== Assistant response ===");
  console.log(completion.choices[0]?.message?.content);

  const summaryEntry = store.get("running-summary");
  if (summaryEntry) {
    console.log("\n=== Stored summary ===");
    console.log(summaryEntry.data.content);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
