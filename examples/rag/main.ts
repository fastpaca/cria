import { cria, type Prompt } from "@fastpaca/cria";
import type {
  MemoryEntry,
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
  private readonly store = new Map<string, MemoryEntry<string>>();

  constructor(docs: Array<{ key: string; text: string }>) {
    const now = Date.now();
    this.docs = docs;
    for (const doc of docs) {
      this.store.set(doc.key, {
        data: doc.text,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  get(key: string): MemoryEntry<string> | null {
    return this.store.get(key) ?? null;
  }

  set(key: string, data: string): void {
    const now = Date.now();
    const existing = this.store.get(key);
    this.store.set(key, {
      data,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    const existingDocIndex = this.docs.findIndex((doc) => doc.key === key);
    if (existingDocIndex >= 0) {
      this.docs[existingDocIndex] = { key, text: data };
    } else {
      this.docs.push({ key, text: data });
    }
  }

  delete(key: string): boolean {
    const removed = this.store.delete(key);
    if (removed) {
      const index = this.docs.findIndex((doc) => doc.key === key);
      if (index >= 0) {
        this.docs.splice(index, 1);
      }
    }
    return removed;
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
const enc = encoding_for_model("gpt-4o-mini");
const tokenizer = (text: string): number => enc.encode(text).length;

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

const systemRules = (): Prompt =>
  cria
    .prompt()
    .system("You answer questions using the provided context. Be concise.");

const retrieval = (query: string): Prompt =>
  cria.prompt().vectorSearch({
    store,
    query,
    limit: 3,
    priority: 2,
    id: "vector-results",
  });

const userRequest = (question: string): Prompt => cria.prompt().user(question);

const prompt = cria.merge(
  systemRules(),
  retrieval("Berlin history and key facts"),
  userRequest("Tell me about Berlin.")
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

  console.log("=== Answer ===");
  console.log(completion.choices[0]?.message?.content);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
