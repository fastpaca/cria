import type { ZodError } from "zod";
import { c, cria, type PromptBuilder } from "../dsl";
import { render } from "../render";
import { markdownRenderer } from "../renderers/markdown";
import {
  coalesceTextParts,
  collectMessageNodes,
  collectSemanticParts,
  type SemanticPart,
  safeStringify,
} from "../renderers/shared";
import type {
  CompletionMessage,
  EvaluatorOutput,
  EvaluatorProvider,
  ModelProvider,
  PromptElement,
  PromptRenderer,
  Tokenizer,
} from "../types";
import { EvaluatorOutputSchema } from "../types";

export const DEFAULT_THRESHOLD = 0.8;

const VARIABLE_PATTERN = /\{\{([^}]+)\}\}/g;

/**
 * Options for evaluating a prompt.
 */
export interface EvalOptions {
  /** Model provider to generate the prompt response under test */
  target: ModelProvider;
  /** Evaluator provider that returns structured output (recommend: gpt-4o-mini for cost/quality balance) */
  evaluator: EvaluatorProvider;
  /** Input variables to substitute into the prompt template */
  input: Record<string, unknown>;
  /** Criteria to evaluate against (e.g. ["helpful", "accurate"]) */
  criteria?: string[];
  /** Expected output for comparison (optional) */
  expected?: string;
  /** Minimum score to pass (default: 0.8) */
  threshold?: number;
  /**
   * Maximum time in milliseconds for each LLM call (target and evaluator).
   * Note: the underlying provider call is not cancelled when this fires.
   */
  timeoutMs?: number;
}

/**
 * Result from evaluating a prompt.
 */
export interface EvalResult {
  /** Whether the evaluation passed (score >= threshold) */
  passed: boolean;
  /** Numeric score from 0 to 1 */
  score: number;
  /** Evaluator's reasoning for the score */
  reasoning: string;
  /** The actual response from the prompt being evaluated */
  response: string;
}

/**
 * Options for creating a mock evaluator for testing.
 */
export interface MockEvaluatorOptions {
  /** Fixed score to return (0-1) */
  score?: number;
  /** Fixed reasoning to return */
  reasoning?: string;
}

/**
 * Options for creating a mock target model for testing.
 */
export interface MockTargetOptions {
  /** Fixed response to return from prompt execution */
  response?: string;
}

export class CriaEvalError extends Error {
  readonly code: string;

  constructor(message: string, code: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CriaEvalError";
    this.code = code;
  }
}

export class EvalSchemaError extends CriaEvalError {
  readonly zodError: ZodError;
  readonly rawOutput: unknown;

  constructor(zodError: ZodError, rawOutput: unknown) {
    super(
      `Evaluator output did not match expected schema: ${zodError.message}`,
      "EVAL_SCHEMA_ERROR"
    );
    this.name = "EvalSchemaError";
    this.zodError = zodError;
    this.rawOutput = rawOutput;
  }
}

export class EvalTargetError extends CriaEvalError {
  readonly provider: string;

  constructor(provider: string, cause: unknown) {
    super(
      `Target provider "${provider}" failed to generate a response.`,
      "EVAL_TARGET_ERROR",
      { cause }
    );
    this.name = "EvalTargetError";
    this.provider = provider;
  }
}

export class EvalEvaluatorError extends CriaEvalError {
  readonly provider: string;

  constructor(provider: string, cause: unknown) {
    super(
      `Evaluator provider "${provider}" failed to score the response.`,
      "EVAL_EVALUATOR_ERROR",
      { cause }
    );
    this.name = "EvalEvaluatorError";
    this.provider = provider;
  }
}

type EvalTimeoutPhase = "target" | "evaluator";

export class EvalTimeoutError extends CriaEvalError {
  readonly phase: EvalTimeoutPhase;
  readonly timeoutMs: number;

  constructor(phase: EvalTimeoutPhase, timeoutMs: number) {
    super(
      `Evaluation ${phase} request timed out after ${timeoutMs}ms.`,
      "EVAL_TIMEOUT"
    );
    this.name = "EvalTimeoutError";
    this.phase = phase;
    this.timeoutMs = timeoutMs;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  phase: EvalTimeoutPhase
): Promise<T> {
  if (timeoutMs === undefined || timeoutMs <= 0) {
    return promise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new EvalTimeoutError(phase, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Build the evaluator prompt using Cria (dogfooding!).
 *
 * Uses structured output for reliable evaluations.
 */
function buildEvaluatorPrompt(options: {
  input: Record<string, unknown>;
  response: string;
  criteria?: string[];
  expected?: string;
}): PromptBuilder {
  const criteria =
    options.criteria && options.criteria.length > 0
      ? options.criteria
      : ["Overall quality and correctness"];
  const inputJson = JSON.stringify(options.input, null, 2);
  const criteriaList = criteria.map((item) => `- ${item}`).join("\n");

  const formatSection = (title: string, body: string) =>
    c`${title}:\n${body}\n\n\n`;

  const system = c`
    You are an expert evaluator for LLM outputs. Assess response quality against the criteria.

    Return a JSON object with:
      - score: number from 0.0 to 1.0
      - reasoning: short explanation

    Do not include any other text.
  `;

  return cria
    .prompt()
    .system(system)
    .user((m) =>
      m.scope((s) => s.append(formatSection("Original Input", inputJson)))
    )
    .assistant(options.response)
    .user((m) => {
      let next = m.scope((s) =>
        s.append(formatSection("Evaluation Criteria", criteriaList))
      );
      if (options.expected) {
        next = next.scope((s) =>
          s.append(formatSection("Expected Response", options.expected))
        );
      }
      return next.append(c`Please evaluate the assistant's response above.`);
    });
}

function substituteVariables(
  text: string,
  input: Record<string, unknown>
): string {
  if (Object.keys(input).length === 0) {
    return text;
  }

  return text.replace(VARIABLE_PATTERN, (match, rawKey: string) => {
    if (!Object.hasOwn(input, rawKey)) {
      return match;
    }
    return safeStringify(input[rawKey]);
  });
}

const completionMessagesRenderer: PromptRenderer<CompletionMessage[]> = {
  name: "completion-messages",
  tokenString: markdownRenderer.tokenString,
  render: (element) => renderToCompletionMessages(element),
  empty: () => [],
};

function renderToCompletionMessages(
  element: PromptElement
): CompletionMessage[] {
  const messageNodes = collectMessageNodes(element);
  if (messageNodes.length === 0) {
    const fallback = markdownRenderer.render(element);
    if (fallback.length === 0) {
      return [];
    }

    return [{ role: "user", content: fallback }];
  }

  const messages: CompletionMessage[] = [];
  for (const messageNode of messageNodes) {
    const parts = coalesceTextParts(collectSemanticParts(messageNode.children));
    const content = semanticPartsToContent(parts);
    if (content.length === 0) {
      continue;
    }

    messages.push({ role: messageNode.role, content });
  }

  return messages;
}

function extractSystemPrompt(
  messages: CompletionMessage[]
): string | undefined {
  const systemParts: string[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(message.content);
    }
  }

  if (systemParts.length === 0) {
    return undefined;
  }

  return systemParts.join("\n");
}

function semanticPartsToContent(parts: readonly SemanticPart[]): string {
  let result = "";

  for (const part of parts) {
    switch (part.type) {
      case "text":
        result += part.text;
        break;
      case "reasoning":
        result += `<thinking>\n${part.text}\n</thinking>\n`;
        break;
      case "tool-call":
        result += `<tool_call name="${part.toolName}">\n${safeStringify(part.input, true)}\n</tool_call>\n`;
        break;
      case "tool-result":
        result += `<tool_result name="${part.toolName}">\n${safeStringify(part.output, true)}\n</tool_result>\n`;
        break;
      default:
        break;
    }
  }

  return result;
}

const DEFAULT_RENDER_BUDGET = 100_000;
const fallbackTokenizer: Tokenizer = (text) => text.length;

function resolvePromptElement(
  prompt: PromptBuilder | PromptElement
): Promise<PromptElement> {
  if ("build" in prompt && typeof prompt.build === "function") {
    return prompt.build();
  }
  return Promise.resolve(prompt);
}

async function renderPromptToMessages(
  prompt: PromptBuilder | PromptElement,
  options: {
    tokenizer?: Tokenizer;
    budget?: number;
    input: Record<string, unknown>;
  }
): Promise<CompletionMessage[]> {
  const element = await resolvePromptElement(prompt);
  const rendered = await render(element, {
    tokenizer: options.tokenizer ?? fallbackTokenizer,
    budget: options.budget ?? DEFAULT_RENDER_BUDGET,
    renderer: completionMessagesRenderer,
  });

  return rendered.map((message) => ({
    ...message,
    content: substituteVariables(message.content, options.input),
  }));
}

function parseEvaluatorOutput(output: unknown): EvaluatorOutput {
  const result = EvaluatorOutputSchema.safeParse(output);

  if (!result.success) {
    throw new EvalSchemaError(result.error, output);
  }

  return result.data;
}

/**
 * Evaluate a prompt using an LLM evaluator.
 *
 * The evaluation process:
 * 1. Render the prompt with the given input variables
 * 2. Execute the prompt against a model (using the target provider)
 * 3. Have the evaluator evaluate the response against the criteria
 * 4. Return structured results with score, pass/fail, and reasoning
 *
 * Security note: input values and model responses are embedded verbatim into the
 * evaluator prompt. Treat this as a trusted test environment; untrusted inputs
 * can influence the evaluator unless you apply additional safeguards.
 *
 * @example
 * ```typescript
 * const result = await evaluate(myPrompt, {
 *   target: openaiProvider,
 *   evaluator: evaluatorProvider,
 *   input: { question: "What is 2+2?" },
 *   criteria: ["accurate", "concise"],
 *   threshold: 0.8,
 * });
 *
 * expect(result.passed).toBe(true);
 * expect(result.score).toBeGreaterThan(0.8);
 * ```
 */
export async function evaluate(
  prompt: PromptBuilder | PromptElement,
  options: EvalOptions
): Promise<EvalResult> {
  const {
    target,
    evaluator,
    input,
    criteria,
    expected,
    threshold = DEFAULT_THRESHOLD,
    timeoutMs,
  } = options;

  // Step 1: Render the prompt to structured messages with variables substituted
  const renderTokenizer = target.tokenizer;
  const renderedMessages = await renderPromptToMessages(prompt, {
    ...(renderTokenizer && { tokenizer: renderTokenizer }),
    input,
  });
  const system = extractSystemPrompt(renderedMessages);

  // Step 2: Execute the prompt to get a response
  let promptResponse: { text: string };
  try {
    promptResponse = await withTimeout(
      Promise.resolve(
        target.completion({
          messages: renderedMessages,
          ...(system !== undefined && { system }),
        })
      ),
      timeoutMs,
      "target"
    );
  } catch (error) {
    if (error instanceof CriaEvalError) {
      throw error;
    }
    throw new EvalTargetError(target.name, error);
  }

  const response = promptResponse.text;

  // Step 3: Build and render the evaluator prompt using Cria (dogfooding!)
  const evaluatorPrompt = buildEvaluatorPrompt({
    input,
    response,
    ...(criteria && { criteria }),
    ...(expected && { expected }),
  });

  const evaluatorRenderTokenizer = evaluator.tokenizer;
  const evaluatorMessages = await renderPromptToMessages(evaluatorPrompt, {
    ...(evaluatorRenderTokenizer && { tokenizer: evaluatorRenderTokenizer }),
    input: {}, // Evaluator prompt has no variables
  });

  // Step 4: Execute the evaluator prompt
  let evaluatorResponse: EvaluatorOutput;
  try {
    evaluatorResponse = await withTimeout(
      Promise.resolve(
        evaluator.evaluate({
          messages: evaluatorMessages,
          input,
          response,
          ...(criteria && { criteria }),
          ...(expected && { expected }),
        })
      ),
      timeoutMs,
      "evaluator"
    );
  } catch (error) {
    if (error instanceof CriaEvalError) {
      throw error;
    }
    throw new EvalEvaluatorError(evaluator.name, error);
  }

  // Step 5: Parse and return the evaluation result
  const evaluation = parseEvaluatorOutput(evaluatorResponse);

  return {
    passed: evaluation.score >= threshold,
    score: evaluation.score,
    reasoning: evaluation.reasoning,
    response,
  };
}

/**
 * Create a mock evaluator for testing evaluations without making LLM calls.
 *
 * @example
 * ```typescript
 * import { evaluate, mockEvaluator, mockTarget } from "@fastpaca/cria/eval";
 *
 * const result = await evaluate(myPrompt, {
 *   target: mockTarget(),
 *   evaluator: mockEvaluator({ score: 0.9 }),
 *   input: { question: "Test question" },
 *   criteria: ["accurate"],
 * });
 *
 * expect(result.score).toBe(0.9);
 * expect(result.passed).toBe(true);
 * ```
 */
export function mockEvaluator(
  options: MockEvaluatorOptions = {}
): EvaluatorProvider {
  const {
    score = 0.85,
    reasoning = "Mock evaluation - all criteria met satisfactorily.",
  } = options;

  return {
    name: "mock-evaluator",
    evaluate: () => ({ score, reasoning }),
  };
}

/**
 * Create a mock target model for testing prompt execution.
 */
export function mockTarget(options: MockTargetOptions = {}): ModelProvider {
  const { response = "Mock response from the prompt under evaluation." } =
    options;

  return {
    name: "mock-target",
    completion: () => Promise.resolve({ text: response }),
  };
}
