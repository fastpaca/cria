import type { PromptElement } from "./types";

type ComponentFn = (props: Props) => PromptElement;
type Child =
  | PromptElement
  | string
  | number
  | boolean
  | null
  | undefined
  | Child[];
type Props = Record<string, unknown> & { children?: Child | Child[] };

// Normalize children: flatten arrays, filter nullish, coerce numbers to strings
function normalizeChildren(
  children: Child | Child[] | undefined
): (PromptElement | string)[] {
  if (children === undefined || children === null) {
    return [];
  }
  if (typeof children === "boolean") {
    return [];
  }
  if (typeof children === "string") {
    return [children];
  }
  if (typeof children === "number") {
    return [String(children)];
  }

  if (Array.isArray(children)) {
    const result: (PromptElement | string)[] = [];
    for (const child of children) {
      result.push(...normalizeChildren(child));
    }
    return result;
  }

  // It's a PromptElement
  return [children];
}

// Fragment: just returns children (inlined into parent)
export const Fragment = Symbol.for("cria.fragment");

// jsx: called by TypeScript for single child
export function jsx(
  type: ComponentFn | typeof Fragment,
  props: Props
): PromptElement {
  const children = normalizeChildren(props.children);

  if (type === Fragment) {
    // Fragment returns a wrapper element that just holds children
    return { priority: 0, children };
  }

  return type({ ...props, children });
}

// jsxs: called by TypeScript for multiple children (same behavior)
export function jsxs(
  type: ComponentFn | typeof Fragment,
  props: Props
): PromptElement {
  return jsx(type, props);
}

// biome-ignore lint/style/noNamespace: Required for JSX type definitions
export namespace JSX {
  export type Element = PromptElement;
  // biome-ignore lint/complexity/noBannedTypes lint/style/useConsistentTypeDefinitions: Required empty type for JSX
  export type IntrinsicElements = {};
  export interface ElementChildrenAttribute {
    children: unknown;
  }
}
