import {
  type ChatCompletionsInput,
  cria,
  InMemoryStore,
  type PromptNode,
  type PromptPart,
  type PromptTree,
  ProtocolProvider,
  type ProviderToolIO,
  type RenderHooks,
  type ResponsesInput,
  type ResponsesToolIO,
  render,
  type StoredSummary,
  type SummarizerContext,
} from "@fastpaca/cria";
import type { ModelMessage } from "ai";
import { getEncoding } from "js-tiktoken";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { bench, describe } from "vitest";
import type { z } from "zod";
import { ChatCompletionsProtocol } from "../src/protocols/chat-completions";
import { ResponsesProtocol } from "../src/protocols/responses";
import { AiSdkAdapter, type AiSdkToolIO } from "../src/providers/ai-sdk";
import {
  OpenAIChatAdapter,
  OpenAIResponsesAdapter,
} from "../src/providers/openai";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

const ROLE_SEPARATOR = ": ";
const WHITESPACE_RE = /\s+/g;
const TOOL_EVERY = 12;

const systemPrompt =
  "You are Cria, a rendering engine that must follow instructions exactly while staying within a strict token budget.";
const developerPrompt =
  "Prefer correctness over creativity. When trimming context, keep the most recent and most actionable details.";
const latestUserPrompt =
  "Given the conversation and retrieved context, propose the next best tool call and a concise assistant message.";

interface BodyBase {
  historyUser: string;
  historyAssistant: string;
  example: string;
  optional: string;
  toolArgs: string;
  toolResult: string;
}

const DEFAULT_BODY_BASE: BodyBase = {
  historyUser: "The user describes steps, constraints, and notes. ",
  historyAssistant:
    "The assistant reflects context, proposes a plan, and adds rationale. ",
  example: "Helpful example content that can be trimmed. ",
  optional: "Low-priority context that should drop early. ",
  toolArgs: JSON.stringify({ query: "alpha", limit: 5 }),
  toolResult: "Tool result with retrieved context and supporting details.",
};

type OpenAIChatToolIO = ResponsesToolIO;
type OpenAIResponsesToolIO = ResponsesToolIO;

class OpenAIChatOfflineProvider extends ProtocolProvider<
  ChatCompletionMessageParam[],
  ChatCompletionsInput<OpenAIChatToolIO>,
  OpenAIChatToolIO
> {
  constructor() {
    super(
      new ChatCompletionsProtocol<OpenAIChatToolIO>(),
      new OpenAIChatAdapter()
    );
  }

  countTokens(messages: ChatCompletionMessageParam[]): number {
    let total = 0;
    for (const message of messages) {
      total += countChatMessageTokens(message);
    }
    return total;
  }

  completion(_messages: ChatCompletionMessageParam[]): Promise<string> {
    throw new Error(
      "OpenAI chat offline provider does not implement completion()."
    );
  }

  object<T>(
    _messages: ChatCompletionMessageParam[],
    _schema: z.ZodType<T>
  ): Promise<T> {
    throw new Error(
      "OpenAI chat offline provider does not implement object()."
    );
  }
}

class OpenAIResponsesOfflineProvider extends ProtocolProvider<
  ResponseInputItem[],
  ResponsesInput,
  OpenAIResponsesToolIO
> {
  constructor() {
    super(new ResponsesProtocol(), new OpenAIResponsesAdapter());
  }

  countTokens(items: ResponseInputItem[]): number {
    let total = 0;
    for (const item of items) {
      total += countResponseItemTokens(item);
    }
    return total;
  }

  completion(_items: ResponseInputItem[]): Promise<string> {
    throw new Error(
      "OpenAI responses offline provider does not implement completion()."
    );
  }

  object<T>(_items: ResponseInputItem[], _schema: z.ZodType<T>): Promise<T> {
    throw new Error(
      "OpenAI responses offline provider does not implement object()."
    );
  }
}

class AiSdkOfflineProvider extends ProtocolProvider<
  ModelMessage[],
  ChatCompletionsInput<AiSdkToolIO>,
  AiSdkToolIO
> {
  constructor() {
    super(new ChatCompletionsProtocol<AiSdkToolIO>(), new AiSdkAdapter());
  }

  countTokens(messages: ModelMessage[]): number {
    let total = 0;
    for (const message of messages) {
      total += countModelMessageTokens(message);
    }
    return total;
  }

  completion(_messages: ModelMessage[]): Promise<string> {
    throw new Error("AI SDK offline provider does not implement completion().");
  }

  object<T>(_messages: ModelMessage[], _schema: z.ZodType<T>): Promise<T> {
    throw new Error("AI SDK offline provider does not implement object().");
  }
}

function countChatMessageTokens(message: ChatCompletionMessageParam): number {
  const contentTokens =
    "content" in message ? countChatContentTokens(message.content) : 0;
  const toolTokens = countChatToolCallTokens(message);
  return contentTokens + toolTokens;
}

function countResponseItemTokens(item: ResponseInputItem): number {
  if ("content" in item && typeof item.content === "string") {
    return countText(item.content);
  }

  const messageTokens = countResponseMessageTokens(item);
  if (messageTokens !== null) {
    return messageTokens;
  }

  const reasoningTokens = countResponseReasoningTokens(item);
  if (reasoningTokens !== null) {
    return reasoningTokens;
  }

  const functionCallTokens = countResponseFunctionCallTokens(item);
  if (functionCallTokens !== null) {
    return functionCallTokens;
  }

  const functionOutputTokens = countResponseFunctionOutputTokens(item);
  if (functionOutputTokens !== null) {
    return functionOutputTokens;
  }

  return 0;
}

function countModelMessageTokens(message: ModelMessage): number {
  if (typeof message.content === "string") {
    return countText(message.content);
  }

  let tokens = 0;
  for (const part of message.content) {
    if (part.type === "text" || part.type === "reasoning") {
      tokens += countText(part.text);
      continue;
    }

    if (part.type === "tool-call") {
      const input =
        typeof part.input === "string"
          ? part.input
          : JSON.stringify(part.input);
      tokens += countText(part.toolName + input);
      continue;
    }

    if (part.type === "tool-result") {
      const output =
        typeof part.output === "string"
          ? part.output
          : JSON.stringify(part.output);
      tokens += countText(output);
    }
  }
  return tokens;
}

function countChatContentTokens(
  content: ChatCompletionMessageParam["content"]
): number {
  if (typeof content === "string") {
    return countText(content);
  }
  if (!Array.isArray(content)) {
    return 0;
  }
  return countTextParts(content);
}

function countChatToolCallTokens(message: ChatCompletionMessageParam): number {
  if (!("tool_calls" in message && Array.isArray(message.tool_calls))) {
    return 0;
  }

  let tokens = 0;
  for (const call of message.tool_calls) {
    if (call.type === "function") {
      tokens += countText(call.function.name + call.function.arguments);
    }
  }
  return tokens;
}

function countResponseMessageTokens(item: ResponseInputItem): number | null {
  if (!("type" in item) || item.type !== "message") {
    return null;
  }
  if (!Array.isArray(item.content)) {
    return 0;
  }
  return countTextParts(item.content);
}

function countResponseReasoningTokens(item: ResponseInputItem): number | null {
  if (!("type" in item) || item.type !== "reasoning") {
    return null;
  }

  let tokens = 0;
  for (const summary of item.summary) {
    tokens += countText(summary.text);
  }
  return tokens;
}

function countResponseFunctionCallTokens(
  item: ResponseInputItem
): number | null {
  if (!("type" in item) || item.type !== "function_call") {
    return null;
  }
  return countText(item.name + item.arguments);
}

function countResponseFunctionOutputTokens(
  item: ResponseInputItem
): number | null {
  if (!("type" in item) || item.type !== "function_call_output") {
    return null;
  }
  if (typeof item.output === "string") {
    return countText(item.output);
  }
  return countTextParts(item.output);
}

function countTextParts(parts: readonly unknown[]): number {
  let tokens = 0;
  for (const part of parts) {
    if (typeof part === "string") {
      tokens += countText(part);
      continue;
    }
    if (typeof part === "object" && part !== null && "text" in part) {
      const text = part.text;
      if (typeof text === "string") {
        tokens += countText(text);
      }
    }
  }
  return tokens;
}

function renderPart(part: PromptPart<ProviderToolIO>): string {
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

function clampSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}...`;
}

interface FitExpectation {
  minIterations: number;
  requiredPriorities: readonly number[];
}

interface FitMetrics {
  fitStarted: boolean;
  iterations: number;
  priorities: Map<number, number>;
  startTokens: number | null;
  endTokens: number | null;
}

function createFitMetrics(): { metrics: FitMetrics; hooks: RenderHooks } {
  const metrics: FitMetrics = {
    fitStarted: false,
    iterations: 0,
    priorities: new Map<number, number>(),
    startTokens: null,
    endTokens: null,
  };

  const hooks: RenderHooks = {
    onFitStart(event) {
      metrics.fitStarted = true;
      metrics.startTokens = event.totalTokens;
    },
    onFitIteration() {
      metrics.iterations += 1;
    },
    onStrategyApplied(event) {
      const current = metrics.priorities.get(event.priority) ?? 0;
      metrics.priorities.set(event.priority, current + 1);
    },
    onFitComplete(event) {
      metrics.endTokens = event.totalTokens;
    },
    onFitError(event) {
      throw event.error;
    },
  };

  return { metrics, hooks };
}

function assertExpectation(params: {
  name: string;
  baselineTokens: number;
  budget: number;
  tokens: number;
  metrics: FitMetrics;
  expectation: FitExpectation;
}): void {
  const { name, baselineTokens, budget, tokens, metrics, expectation } = params;

  if (baselineTokens > budget && !metrics.fitStarted) {
    throw new Error(`${name}: expected fit loop to start.`);
  }

  if (
    baselineTokens > budget &&
    metrics.iterations < expectation.minIterations
  ) {
    throw new Error(
      `${name}: expected at least ${expectation.minIterations} fit iterations, got ${metrics.iterations}.`
    );
  }

  if (tokens > budget) {
    throw new Error(`${name}: render exceeded budget (${tokens} > ${budget}).`);
  }

  for (const priority of expectation.requiredPriorities) {
    if (!metrics.priorities.has(priority)) {
      throw new Error(
        `${name}: expected strategy at priority ${priority} to apply.`
      );
    }
  }
}

function assertBaselineAboveBudgets(params: {
  name: string;
  baselineTokens: number;
  budgets: { fit: number; tight: number };
}): void {
  const { name, baselineTokens, budgets } = params;
  if (baselineTokens <= budgets.fit || baselineTokens <= budgets.tight) {
    throw new Error(
      `${name}: baseline tokens (${baselineTokens}) must exceed pinned budgets (${budgets.fit}, ${budgets.tight}).`
    );
  }
}

function createOpenAIChatHistory(
  count: number,
  body: BodyBase,
  repeat: number
): ChatCompletionMessageParam[] {
  const userBody = body.historyUser.repeat(repeat);
  const assistantBody = body.historyAssistant.repeat(repeat);
  const messages: ChatCompletionMessageParam[] = [];
  let toolIndex = 0;

  for (let i = 0; i < count; i += 1) {
    const turn = i + 1;
    if (turn % 2 === 1) {
      messages.push({
        role: "user",
        content: `User turn ${turn}. ${userBody}`,
      });
      continue;
    }

    if (turn % TOOL_EVERY === 0) {
      toolIndex += 1;
      const toolCallId = `chat-tool-${toolIndex}`;
      messages.push({
        role: "assistant",
        content: `Assistant turn ${turn}. ${assistantBody}`,
        tool_calls: [
          {
            id: toolCallId,
            type: "function",
            function: { name: "search", arguments: body.toolArgs },
          },
        ],
      });
      messages.push({
        role: "tool",
        tool_call_id: toolCallId,
        content: body.toolResult,
      });
      continue;
    }

    messages.push({
      role: "assistant",
      content: `Assistant turn ${turn}. ${assistantBody}`,
    });
  }

  return messages;
}

function createOpenAIResponsesHistory(
  count: number,
  body: BodyBase,
  repeat: number
): ResponseInputItem[] {
  const userBody = body.historyUser.repeat(repeat);
  const assistantBody = body.historyAssistant.repeat(repeat);
  const items: ResponseInputItem[] = [];
  let toolIndex = 0;

  for (let i = 0; i < count; i += 1) {
    const turn = i + 1;
    if (turn % 2 === 1) {
      items.push({
        type: "message",
        role: "user",
        content: `User turn ${turn}. ${userBody}`,
      });
      continue;
    }

    items.push({
      type: "message",
      role: "assistant",
      content: `Assistant turn ${turn}. ${assistantBody}`,
    });

    if (turn % TOOL_EVERY === 0) {
      toolIndex += 1;
      const callId = `responses-tool-${toolIndex}`;
      items.push({
        type: "function_call",
        call_id: callId,
        name: "search",
        arguments: body.toolArgs,
      });
      items.push({
        type: "function_call_output",
        call_id: callId,
        output: body.toolResult,
      });
    }
  }

  return items;
}

function createAiSdkHistory(
  count: number,
  body: BodyBase,
  repeat: number
): ModelMessage[] {
  const userBody = body.historyUser.repeat(repeat);
  const assistantBody = body.historyAssistant.repeat(repeat);
  const messages: ModelMessage[] = [];
  let toolIndex = 0;

  for (let i = 0; i < count; i += 1) {
    const turn = i + 1;
    if (turn % 2 === 1) {
      messages.push({
        role: "user",
        content: `User turn ${turn}. ${userBody}`,
      });
      continue;
    }

    if (turn % TOOL_EVERY === 0) {
      toolIndex += 1;
      const toolCallId = `aisdk-tool-${toolIndex}`;
      messages.push({
        role: "assistant",
        content: [
          { type: "text", text: `Assistant turn ${turn}. ${assistantBody}` },
          { type: "reasoning", text: "Reasoning about tool usage." },
          {
            type: "tool-call",
            toolCallId,
            toolName: "search",
            input: { query: body.toolArgs, limit: 3 },
          },
        ],
      });
      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId,
            toolName: "search",
            output: body.toolResult,
          },
        ],
      });
      continue;
    }

    messages.push({
      role: "assistant",
      content: `Assistant turn ${turn}. ${assistantBody}`,
    });
  }

  return messages;
}

interface ProviderScenarioConfig<
  TRendered,
  TProtocolInput,
  TToolIO extends ProviderToolIO,
> {
  name: string;
  provider: ProtocolProvider<TRendered, TProtocolInput, TToolIO>;
  history: TRendered;
  counts: {
    examples: number;
    optional: number;
  };
  bodies: {
    exampleRepeat: number;
    optionalRepeat: number;
  };
  priorities: {
    summary: number;
    omit: number;
    truncate: number;
  };
  truncateBudget: number;
  summary: {
    window: number;
    maxChars: number;
  };
  ids: {
    summary: string;
    examples: string;
    optional: string;
  };
  budgets: {
    fit: number;
    tight: number;
  };
  expectations: {
    fit: FitExpectation;
    tight: FitExpectation;
  };
  benchOptions?: {
    time?: number;
    iterations?: number;
  };
}

interface ProviderScenarioResult {
  name: string;
  baselineTokens: number;
  benchOptions?: {
    time?: number;
    iterations?: number;
  };
  renderBaseline: () => Promise<number>;
  renderFitCold: () => Promise<number>;
  renderTightWarm: () => Promise<number>;
}

async function createProviderScenario<
  TRendered,
  TProtocolInput,
  TToolIO extends ProviderToolIO,
>(
  config: ProviderScenarioConfig<TRendered, TProtocolInput, TToolIO>
): Promise<ProviderScenarioResult> {
  const exampleBody = DEFAULT_BODY_BASE.example.repeat(
    config.bodies.exampleRepeat
  );
  const optionalBody = DEFAULT_BODY_BASE.optional.repeat(
    config.bodies.optionalRepeat
  );

  const exampleMessages = Array.from(
    { length: config.counts.examples },
    (_, index) => cria.user(`Example ${index + 1}: ${exampleBody}`)
  );
  const optionalMessages = Array.from(
    { length: config.counts.optional },
    (_, index) => cria.user(`Optional context ${index + 1}: ${optionalBody}`)
  );

  function summarizeHistory(ctx: SummarizerContext): string {
    const lines = collectMessages(ctx.target);
    const windowed = lines.slice(-config.summary.window);
    const recentSummary = clampSummary(
      compact(windowed.join("\n")),
      config.summary.maxChars
    );

    if (ctx.existingSummary === null) {
      return `Summary: ${recentSummary}`;
    }

    const combined = clampSummary(
      compact(`${ctx.existingSummary}\nUpdate: ${recentSummary}`),
      config.summary.maxChars
    );
    return `Summary: ${combined}`;
  }

  function buildPrompt(store: InMemoryStore<StoredSummary>) {
    return cria
      .prompt(config.provider)
      .system(systemPrompt)
      .developer(developerPrompt)
      .summary(cria.input(config.history), {
        id: config.ids.summary,
        store,
        summarize: summarizeHistory,
        priority: config.priorities.summary,
      })
      .truncate(exampleMessages, {
        budget: config.truncateBudget,
        from: "start",
        priority: config.priorities.truncate,
        id: config.ids.examples,
      })
      .omit(optionalMessages, {
        priority: config.priorities.omit,
        id: config.ids.optional,
      })
      .user(latestUserPrompt);
  }

  const coldStore = new InMemoryStore<StoredSummary>();
  const prebuiltElement = await buildPrompt(coldStore).build();
  const baselineRendered = await render(prebuiltElement, {
    provider: config.provider,
  });
  const baselineTokens = config.provider.countTokens(baselineRendered);

  assertBaselineAboveBudgets({
    name: config.name,
    baselineTokens,
    budgets: config.budgets,
  });

  const warmStore = new InMemoryStore<StoredSummary>();
  warmStore.set(config.ids.summary, {
    content: "Seed summary for provider codec benchmarks.",
  });
  const warmElement = await buildPrompt(warmStore).build();

  async function renderWithBudget(params: {
    element: PromptTree;
    store: InMemoryStore<StoredSummary>;
    budgetKey: keyof ProviderScenarioConfig<
      TRendered,
      TProtocolInput,
      TToolIO
    >["budgets"];
    resetSummary: boolean;
  }): Promise<number> {
    const { element, store, budgetKey, resetSummary } = params;
    if (resetSummary) {
      store.delete(config.ids.summary);
    }

    const budget = config.budgets[budgetKey];
    const expectation = config.expectations[budgetKey];
    const { metrics, hooks } = createFitMetrics();

    const rendered = await render(element, {
      provider: config.provider,
      budget,
      hooks,
    });
    const tokens = config.provider.countTokens(rendered);
    assertExpectation({
      name: `${config.name}:${budgetKey}`,
      baselineTokens,
      budget,
      tokens,
      metrics,
      expectation,
    });
    return tokens;
  }

  async function renderBaseline(): Promise<number> {
    const rendered = await render(prebuiltElement, {
      provider: config.provider,
    });
    return config.provider.countTokens(rendered);
  }

  function renderFitCold(): Promise<number> {
    return renderWithBudget({
      element: prebuiltElement,
      store: coldStore,
      budgetKey: "fit",
      resetSummary: true,
    });
  }

  function renderTightWarm(): Promise<number> {
    return renderWithBudget({
      element: warmElement,
      store: warmStore,
      budgetKey: "tight",
      resetSummary: false,
    });
  }

  return {
    name: config.name,
    baselineTokens,
    benchOptions: config.benchOptions,
    renderBaseline,
    renderFitCold,
    renderTightWarm,
  };
}

const openAiChatProvider = new OpenAIChatOfflineProvider();
const openAiResponsesProvider = new OpenAIResponsesOfflineProvider();
const aiSdkProvider = new AiSdkOfflineProvider();

const openAiChatHistory = createOpenAIChatHistory(400, DEFAULT_BODY_BASE, 2);
const openAiResponsesHistory = createOpenAIResponsesHistory(
  400,
  DEFAULT_BODY_BASE,
  2
);
const aiSdkHistory = createAiSdkHistory(400, DEFAULT_BODY_BASE, 2);

const openAiChatSummaryScenario = await createProviderScenario({
  name: "openai-chat-summary-first",
  provider: openAiChatProvider,
  history: openAiChatHistory,
  counts: {
    examples: 48,
    optional: 24,
  },
  bodies: {
    exampleRepeat: 2,
    optionalRepeat: 2,
  },
  priorities: {
    summary: 3,
    omit: 2,
    truncate: 1,
  },
  truncateBudget: 400,
  summary: {
    window: 24,
    maxChars: 800,
  },
  ids: {
    summary: "bench-openai-chat-summary",
    examples: "bench-openai-chat-examples",
    optional: "bench-openai-chat-optional",
  },
  budgets: {
    fit: 10_000,
    tight: 8000,
  },
  expectations: {
    fit: {
      minIterations: 1,
      requiredPriorities: [3],
    },
    tight: {
      minIterations: 1,
      requiredPriorities: [3],
    },
  },
});

const openAiChatStressScenario = await createProviderScenario({
  name: "openai-chat-multi-strategy-stress",
  provider: openAiChatProvider,
  history: openAiChatHistory,
  counts: {
    examples: 48,
    optional: 24,
  },
  bodies: {
    exampleRepeat: 2,
    optionalRepeat: 2,
  },
  priorities: {
    summary: 1,
    omit: 3,
    truncate: 2,
  },
  truncateBudget: 400,
  summary: {
    window: 24,
    maxChars: 1000,
  },
  ids: {
    summary: "bench-openai-chat-stress-summary",
    examples: "bench-openai-chat-stress-examples",
    optional: "bench-openai-chat-stress-optional",
  },
  budgets: {
    fit: 10_000,
    tight: 8000,
  },
  expectations: {
    fit: {
      minIterations: 4,
      requiredPriorities: [3, 2, 1],
    },
    tight: {
      minIterations: 4,
      requiredPriorities: [3, 2, 1],
    },
  },
});

const openAiResponsesSummaryScenario = await createProviderScenario({
  name: "openai-responses-summary-first",
  provider: openAiResponsesProvider,
  history: openAiResponsesHistory,
  counts: {
    examples: 48,
    optional: 24,
  },
  bodies: {
    exampleRepeat: 2,
    optionalRepeat: 2,
  },
  priorities: {
    summary: 3,
    omit: 2,
    truncate: 1,
  },
  truncateBudget: 400,
  summary: {
    window: 24,
    maxChars: 800,
  },
  ids: {
    summary: "bench-openai-responses-summary",
    examples: "bench-openai-responses-examples",
    optional: "bench-openai-responses-optional",
  },
  budgets: {
    fit: 10_000,
    tight: 8000,
  },
  expectations: {
    fit: {
      minIterations: 1,
      requiredPriorities: [3],
    },
    tight: {
      minIterations: 1,
      requiredPriorities: [3],
    },
  },
});

const openAiResponsesStressScenario = await createProviderScenario({
  name: "openai-responses-multi-strategy-stress",
  provider: openAiResponsesProvider,
  history: openAiResponsesHistory,
  counts: {
    examples: 48,
    optional: 24,
  },
  bodies: {
    exampleRepeat: 2,
    optionalRepeat: 2,
  },
  priorities: {
    summary: 1,
    omit: 3,
    truncate: 2,
  },
  truncateBudget: 400,
  summary: {
    window: 24,
    maxChars: 1000,
  },
  ids: {
    summary: "bench-openai-responses-stress-summary",
    examples: "bench-openai-responses-stress-examples",
    optional: "bench-openai-responses-stress-optional",
  },
  budgets: {
    fit: 10_000,
    tight: 8000,
  },
  expectations: {
    fit: {
      minIterations: 4,
      requiredPriorities: [3, 2, 1],
    },
    tight: {
      minIterations: 4,
      requiredPriorities: [3, 2, 1],
    },
  },
});

const aiSdkSummaryScenario = await createProviderScenario({
  name: "ai-sdk-summary-first",
  provider: aiSdkProvider,
  history: aiSdkHistory,
  counts: {
    examples: 48,
    optional: 24,
  },
  bodies: {
    exampleRepeat: 2,
    optionalRepeat: 2,
  },
  priorities: {
    summary: 3,
    omit: 2,
    truncate: 1,
  },
  truncateBudget: 400,
  summary: {
    window: 24,
    maxChars: 800,
  },
  ids: {
    summary: "bench-ai-sdk-summary",
    examples: "bench-ai-sdk-examples",
    optional: "bench-ai-sdk-optional",
  },
  budgets: {
    fit: 10_000,
    tight: 8000,
  },
  expectations: {
    fit: {
      minIterations: 1,
      requiredPriorities: [3],
    },
    tight: {
      minIterations: 1,
      requiredPriorities: [3],
    },
  },
});

const aiSdkStressScenario = await createProviderScenario({
  name: "ai-sdk-multi-strategy-stress",
  provider: aiSdkProvider,
  history: aiSdkHistory,
  counts: {
    examples: 48,
    optional: 24,
  },
  bodies: {
    exampleRepeat: 2,
    optionalRepeat: 2,
  },
  priorities: {
    summary: 1,
    omit: 3,
    truncate: 2,
  },
  truncateBudget: 400,
  summary: {
    window: 24,
    maxChars: 1000,
  },
  ids: {
    summary: "bench-ai-sdk-stress-summary",
    examples: "bench-ai-sdk-stress-examples",
    optional: "bench-ai-sdk-stress-optional",
  },
  budgets: {
    fit: 10_000,
    tight: 8000,
  },
  expectations: {
    fit: {
      minIterations: 4,
      requiredPriorities: [3, 2, 1],
    },
    tight: {
      minIterations: 4,
      requiredPriorities: [3, 2, 1],
    },
  },
});

describe("golden codec render loop (OpenAI chat)", () => {
  bench("render baseline (chat codec)", async () => {
    await openAiChatSummaryScenario.renderBaseline();
  });

  bench("render fit budget (chat codec)", async () => {
    await openAiChatSummaryScenario.renderFitCold();
  });

  bench("render tight budget (chat codec)", async () => {
    await openAiChatSummaryScenario.renderTightWarm();
  });

  bench("render multi-strategy stress (chat codec)", async () => {
    await openAiChatStressScenario.renderFitCold();
  });
});

describe("golden codec render loop (OpenAI responses)", () => {
  bench("render baseline (responses codec)", async () => {
    await openAiResponsesSummaryScenario.renderBaseline();
  });

  bench("render fit budget (responses codec)", async () => {
    await openAiResponsesSummaryScenario.renderFitCold();
  });

  bench("render tight budget (responses codec)", async () => {
    await openAiResponsesSummaryScenario.renderTightWarm();
  });

  bench("render multi-strategy stress (responses codec)", async () => {
    await openAiResponsesStressScenario.renderFitCold();
  });
});

describe("golden codec render loop (AI SDK)", () => {
  bench("render baseline (ai-sdk codec)", async () => {
    await aiSdkSummaryScenario.renderBaseline();
  });

  bench("render fit budget (ai-sdk codec)", async () => {
    await aiSdkSummaryScenario.renderFitCold();
  });

  bench("render tight budget (ai-sdk codec)", async () => {
    await aiSdkSummaryScenario.renderTightWarm();
  });

  bench("render multi-strategy stress (ai-sdk codec)", async () => {
    await aiSdkStressScenario.renderFitCold();
  });
});
