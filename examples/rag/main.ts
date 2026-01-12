import { cria } from "@fastpaca/cria";
import type {
  VectorMemory,
  VectorSearchOptions,
  VectorSearchResult,
} from "@fastpaca/cria/memory";
import { chatCompletions } from "@fastpaca/cria/openai";
import OpenAI from "openai";
import { encoding_for_model } from "tiktoken";

// Minimal in-memory vector store for demo purposes
class DemoVectorStore implements VectorMemory<string> {
  private readonly docs: Array<{ key: string; text: string }>;

  constructor(docs: Array<{ key: string; text: string }>) {
    this.docs = docs;
  }

  search(
    query: string,
    options: VectorSearchOptions
  ): Promise<VectorSearchResult<string>[]> {
    const normalized = query.toLowerCase();
    const matches = this.docs
      .filter((doc) => doc.text.toLowerCase().includes(normalized))
      .slice(0, options.limit ?? 5);

    return Promise.resolve(
      matches.map((doc, index) => ({
        key: doc.key,
        score: 1 - index * 0.1,
        entry: {
          data: doc.text,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      }))
    );
  }
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const tokenizer = (text: string): number =>
  encoding_for_model("gpt-4o-mini").encode(text).length;

const store = new DemoVectorStore([
  {
    key: "berlin",
    text: "Berlin is the capital of Germany with ~3.7M people.",
  },
  {
    key: "history",
    text: "Berlin was divided during the Cold War and reunified in 1990.",
  },
  {
    key: "landmark",
    text: "The Brandenburg Gate is a famous Berlin landmark.",
  },
]);

const prompt = cria
  .prompt()
  .system("You answer questions using the provided context. Be concise.")
  .vectorSearch({
    store,
    query: "Berlin history and key facts",
    limit: 3,
    priority: 2,
    id: "vector-results",
  })
  .user("Tell me about Berlin.");

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

  console.log("=== Answer ===");
  console.log(completion.choices[0]?.message?.content);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
