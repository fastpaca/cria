import { inputLayout, merge, prompt } from "./dsl";
import { createMessage, createScope } from "./dsl/strategies";
import {
  normalizeTextInput,
  type TextInput,
  c as templateC,
} from "./dsl/templating";
import { history } from "./memory/history";
import { summarizer } from "./memory/summarizer";
import { vectordb } from "./memory/vector-store";
import type {
  PromptMessageNode,
  PromptRole,
  PromptScope,
  ProviderToolIO,
  ScopeChildren,
} from "./types";

/** Create a standalone message node */
function message<TToolIO extends ProviderToolIO>(
  role: PromptRole,
  content: TextInput<TToolIO>
): PromptMessageNode<TToolIO> {
  return createMessage(role, normalizeTextInput<TToolIO>(content));
}

/** Create a standalone scope node */
function scope<TToolIO extends ProviderToolIO>(
  children: ScopeChildren<TToolIO>,
  opts?: { priority?: number; id?: string }
): PromptScope<TToolIO> {
  return createScope(children, opts);
}

/**
 * Namespace for building prompts as code.
 *
 * @example
 * ```typescript
 * import { cria } from "@fastpaca/cria";
 *
 * // Full prompt builder
 * const prompt = cria
 *   .prompt()
 *   .system("You are helpful.")
 *   .user("Hello!")
 *   .build();
 *
 * // Standalone nodes
 * const msg = cria.user("Hello!");
 * const root = cria.scope([msg]);
 * ```
 */
export const cria = {
  prompt,
  c: templateC,
  merge,
  // Standalone node creators
  message,
  scope,
  user: (content: TextInput) => message("user", content),
  system: (content: TextInput) => message("system", content),
  developer: (content: TextInput) => message("developer", content),
  assistant: (content: TextInput) => message("assistant", content),
  history,
  inputLayout,
  summarizer,
  vectordb,
} as const;
