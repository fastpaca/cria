import type { MaybePromise, PromptChildren, PromptElement } from "../types";

type ComponentFn = (props: Props) => MaybePromise<PromptElement>;

/**
 * JSX child input type (pre-normalization).
 *
 * Why this exists:
 * - `PromptElement.children` (the IR) is always stored as canonical `PromptChildren`
 *   (`PromptElement | string` flattened into an array).
 * - But JSX syntax allows much more: numbers, booleans, null/undefined, and nested arrays.
 *   TypeScript will type-check those against the component prop type.
 *
 * This type represents what JSX can pass in; `normalizeChildren()` is the only place
 * we flatten/filter/coerce into the canonical IR representation.
 *
 * Keep this type local to the JSX runtime to avoid leaking JSX-specific concerns
 * into core IR and renderer types.
 */
export type Child =
  | PromptElement
  | Promise<PromptElement>
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly Child[];

type Props = Record<string, unknown> & { children?: Child };

// Normalize children: flatten arrays, filter nullish, coerce numbers to strings
async function normalizeChildren(
  children: Child | undefined
): Promise<PromptChildren> {
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

  if (isChildrenArray(children)) {
    const normalized = await Promise.all(
      children.map((child) => normalizeChildren(child))
    );
    return normalized.flat();
  }

  // It's a PromptElement (or a promise for one)
  return [await children];
}

function isChildrenArray(value: Child): value is readonly Child[] {
  return Array.isArray(value);
}

// Fragment: just returns children (inlined into parent)
export const Fragment = Symbol.for("cria.fragment");

// jsx: called by TypeScript for single child
export async function jsx(
  type: ComponentFn | typeof Fragment,
  props: Props
): Promise<PromptElement> {
  const children = await normalizeChildren(props.children);

  if (type === Fragment) {
    // Fragment returns a wrapper element that just holds children
    return { priority: 0, children };
  }

  return await type({ ...props, children });
}

// jsxs: called by TypeScript for multiple children (same behavior)
export async function jsxs(
  type: ComponentFn | typeof Fragment,
  props: Props
): Promise<PromptElement> {
  return await jsx(type, props);
}

// biome-ignore lint/style/noNamespace: JSX namespace is required for TSX support
export declare namespace JSX {
  type Element = MaybePromise<PromptElement>;
  // Allow JSX children to use raw Child inputs even if props expect PromptChildren.
  type LibraryManagedAttributes<_C, P> = P extends {
    children?: PromptChildren;
  }
    ? Omit<P, "children"> & { children?: Child }
    : P;
  interface IntrinsicElements {
    [key: string]: never;
  }
  interface ElementChildrenAttribute {
    children: unknown;
  }
}
