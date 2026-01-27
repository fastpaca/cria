import {
  cria,
  FitError,
  InMemoryStore,
  type PromptNode,
  type PromptPart,
  render,
  type StoredSummary,
  type SummarizerContext,
} from "@fastpaca/cria";
import { bench, describe } from "vitest";
import { createTestProvider } from "../src/testing/plaintext";

const provider = createTestProvider({
  joinMessagesWith: "\n\n",
  includeRolePrefix: true,
});

const HISTORY_MESSAGES = 120;
const EXAMPLE_MESSAGES = 48;
const OPTIONAL_MESSAGES = 24;
const TRUNCATE_BUDGET = 400;
const SUMMARY_PRIORITY = 3;
const OMIT_PRIORITY = 2;
const TRUNCATE_PRIORITY = 1;
const SUMMARY_WINDOW = 16;
const SUMMARY_MAX_CHARS = 600;
const ROLE_SEPARATOR = ": ";
const WHITESPACE_RE = /\s+/g;

const systemPrompt =
  "You are Cria, a rendering engine that must follow instructions exactly while staying within a strict token budget.";
const developerPrompt =
  "Prefer correctness over creativity. When trimming context, keep the most recent and most actionable details.";
const latestUserPrompt =
  "Given the conversation and retrieved context, propose the next best tool call and a concise assistant message.";
const exampleBody =
  "Input and output examples that are helpful but expendable when the budget is tight. ".repeat(
    2
  );
const optionalBody =
  "Low-priority supporting information that should be dropped early in the fit loop. ".repeat(
    2
  );

const historyMessages: readonly PromptNode[] =
  buildHistoryMessages(HISTORY_MESSAGES);
const exampleMessages: readonly PromptNode[] =
  buildExampleMessages(EXAMPLE_MESSAGES);
const optionalMessages: readonly PromptNode[] =
  buildOptionalMessages(OPTIONAL_MESSAGES);

function buildHistoryMessages(count: number): readonly PromptNode[] {
  return Array.from({ length: count }, (_, index) => {
    const turn = index + 1;
    if (turn % 2 === 1) {
      const userBody =
        "The user describes a multi-step workflow with constraints, edge cases, and a few long-form notes. ".repeat(
          3
        );
      const userText = `User turn ${turn}. ${userBody}`;
      return cria.user(userText);
    }

    const assistantBody =
      "The assistant reflects prior context, proposes a plan, and includes detailed rationale that can often be summarized. ".repeat(
        3
      );
    const assistantText = `Assistant turn ${turn}. ${assistantBody}`;
    return cria.assistant(assistantText);
  });
}

function buildExampleMessages(count: number): readonly PromptNode[] {
  return Array.from({ length: count }, (_, index) =>
    cria.user(`Example ${index + 1}: ${exampleBody}`)
  );
}

function buildOptionalMessages(count: number): readonly PromptNode[] {
  return Array.from({ length: count }, (_, index) =>
    cria.user(`Optional context ${index + 1}: ${optionalBody}`)
  );
}

function renderPart(part: PromptPart): string {
  if (part.type === "text" || part.type === "reasoning") {
    return part.text;
  }

  if (part.type === "tool-call") {
    return `[tool-call:${part.toolName}]${String(part.input)}`;
  }

  return `[tool-result:${part.toolName}]${String(part.output)}`;
}

function renderMessage(node: Extract<PromptNode, { kind: "message" }>): string {
  let content = "";
  for (const part of node.children) {
    content += renderPart(part);
  }
  return `${node.role}${ROLE_SEPARATOR}${content}`;
}

function collectMessages(node: PromptNode): string[] {
  if (node.kind === "message") {
    return [renderMessage(node)];
  }

  const lines: string[] = [];
  for (const child of node.children) {
    const childLines = collectMessages(child);
    for (const childLine of childLines) {
      lines.push(childLine);
    }
  }
  return lines;
}

function compact(text: string): string {
  return text.replace(WHITESPACE_RE, " ").trim();
}

function clampSummary(text: string): string {
  if (text.length <= SUMMARY_MAX_CHARS) {
    return text;
  }
  return `${text.slice(0, SUMMARY_MAX_CHARS)}...`;
}

function summarizeHistory(ctx: SummarizerContext): string {
  const lines = collectMessages(ctx.target);
  const windowed = lines.slice(-SUMMARY_WINDOW);
  const recentSummary = clampSummary(compact(windowed.join("\n")));

  if (ctx.existingSummary === null) {
    return `Summary: ${recentSummary}`;
  }

  const combined = clampSummary(
    compact(`${ctx.existingSummary}\nUpdate: ${recentSummary}`)
  );
  return `Summary: ${combined}`;
}

function buildPrompt(store: InMemoryStore<StoredSummary>) {
  return cria
    .prompt(provider)
    .system(systemPrompt)
    .developer(developerPrompt)
    .summary(historyMessages, {
      id: "bench-history",
      store,
      summarize: summarizeHistory,
      priority: SUMMARY_PRIORITY,
    })
    .truncate(exampleMessages, {
      budget: TRUNCATE_BUDGET,
      from: "start",
      priority: TRUNCATE_PRIORITY,
      id: "bench-examples",
    })
    .omit(optionalMessages, {
      priority: OMIT_PRIORITY,
      id: "bench-optional",
    })
    .user(latestUserPrompt);
}

async function renderOnce(budget?: number): Promise<number> {
  const store = new InMemoryStore<StoredSummary>();
  const prompt = buildPrompt(store);
  const element = await prompt.build();

  const rendered =
    budget === undefined
      ? await render(element, { provider })
      : await render(element, { provider, budget });

  return provider.countTokens(rendered);
}

async function findFittingBudget(baselineTokens: number): Promise<number> {
  const ratios = [0.35, 0.45, 0.55, 0.65, 0.75];

  for (const ratio of ratios) {
    const budget = Math.max(1, Math.floor(baselineTokens * ratio));
    try {
      await renderOnce(budget);
      return budget;
    } catch (error) {
      if (error instanceof FitError) {
        continue;
      }
      throw error;
    }
  }

  return baselineTokens;
}

const baselineTokens = await renderOnce();
const fittingBudget = await findFittingBudget(baselineTokens);

describe("render loop e2e", () => {
  bench("render baseline (no fit loop)", async () => {
    await renderOnce();
  });

  bench("render with fit loop and strategies", async () => {
    await renderOnce(fittingBudget);
  });
});
