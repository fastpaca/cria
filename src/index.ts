/**
 * Cria - fluent DSL for prompt composition.
 *
 * @example
 * ```ts
 * import { cria } from "@fastpaca/cria";
 *
 * const result = await cria
 *   .prompt(provider)
 *   .system("You are a helpful assistant.")
 *   .truncate(cria.input(conversationHistory), { budget: 20000, from: "start", priority: 2 })
 *   .omit(optionalContext, { priority: 3 })
 *   .render({ budget: 128000 });
 * ```
 *
 * @packageDocumentation
 */

// DSL - primary API
export type {
  BuilderChild,
  Prompt,
  PromptPlugin,
  ScopeContent,
  StoredSummary,
  Summarizer,
  SummarizerComponent,
  SummarizerConfig,
  SummarizerContext,
  SummarizerLoadOptions,
  SummarizerPluginOptions,
  SummarizerUseOptions,
  SummarizerWriteOptions,
  TextInput,
  VectorDBComponent,
  VectorDBConfig,
  VectorDBEntry,
  VectorDBFormatter,
  VectorDBLoadOptions,
  VectorDBSearchOptions,
  VectorDBUseOptions,
} from "./dsl";
export {
  BuilderBase,
  c,
  cria,
  input,
  inputLayout,
  MessageBuilder,
  merge,
  PromptBuilder,
  prompt,
  summarizer,
  vectordb,
} from "./dsl";
export { createOtelRenderHooks } from "./instrumentation/otel";
export type {
  KVMemory,
  MemoryEntry,
  UserScopeOptions,
  VectorMemory,
  VectorSearchOptions,
  VectorSearchResult,
} from "./memory";
// LLM Memory
export {
  InMemoryStore,
  scopeKVStore,
  scopeVectorStore,
} from "./memory";
export type {
  ChatCompletionsInput,
  ChatMessage,
  ChatRole,
} from "./protocols/chat-completions";
export { ChatCompletionsProtocol } from "./protocols/chat-completions";
export type {
  ResponsesContentPart,
  ResponsesFunctionCallItem,
  ResponsesFunctionCallOutputItem,
  ResponsesInput,
  ResponsesItem,
  ResponsesMessageItem,
  ResponsesReasoningItem,
  ResponsesRole,
  ResponsesToolIO,
} from "./protocols/responses";
export { ResponsesProtocol } from "./protocols/responses";
export {
  CompositeCodec,
  type InputLayout,
  ListMessageCodec,
  MessageCodec,
  ModelProvider,
  type PromptInput,
  ProtocolProvider,
  type ProviderAdapter,
} from "./provider";
export type {
  FitCompleteEvent,
  FitErrorEvent,
  FitIterationEvent,
  FitStartEvent,
  RenderHooks,
  RenderOptions,
  StrategyAppliedEvent,
} from "./render";
export { render } from "./render";
export type {
  CacheDescriptor,
  CacheHint,
  CriaContext,
  MaybePromise,
  MessageChildren,
  PromptLayout,
  PromptMessage,
  PromptMessageNode,
  PromptNode,
  PromptPart,
  PromptRole,
  PromptScope,
  PromptTree,
  ProviderToolIO,
  ReasoningPart,
  ScopeChildren,
  Strategy,
  StrategyInput,
  StrategyResult,
  TextPart,
  ToolCallPart,
  ToolIOForProvider,
  ToolResultPart,
} from "./types";
export { FitError } from "./types";
