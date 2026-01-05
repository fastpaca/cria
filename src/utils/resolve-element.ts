import type { MaybePromise, PromptChildren, PromptElement } from "../types";

async function resolveChildren(
  children: PromptChildren
): Promise<PromptChildren> {
  const resolved: PromptChildren = [];

  for (const child of children) {
    if (typeof child === "string") {
      resolved.push(child);
      continue;
    }

    resolved.push(await resolvePromptElement(child));
  }

  return resolved;
}

/**
 * Recursively resolves a PromptElement tree, awaiting any async components
 * and ensuring all children are normalized PromptElements or strings.
 */
export async function resolvePromptElement(
  element: MaybePromise<PromptElement>
): Promise<PromptElement> {
  const resolved = await element;
  const children = await resolveChildren(resolved.children);
  return { ...resolved, children };
}
