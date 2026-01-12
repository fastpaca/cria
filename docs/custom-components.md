# Custom components

Cria building blocks are just functions that return prompt builders or prompt elements. You can build reusable blocks the same way you build UI components—DSL first, with optional JSX if you prefer TSX.

## Basic pattern

```ts
import { cria, type PromptElement } from "@fastpaca/cria";

export function systemRule(text: string) {
  return cria.prompt().system(text);
}

export function systemElement(text: string): PromptElement {
  return {
    kind: "message",
    role: "system",
    priority: 0,
    children: [text],
  };
}
```

## Composed component

```ts
import { cria } from "@fastpaca/cria";

type ContextBlockProps = {
  title: string;
  children: string;
};

export function ContextBlock({ title, children }: ContextBlockProps) {
  return cria
    .prompt()
    .region((r) =>
      r.message("assistant", `${title}\n${children}`, { priority: 2 })
    );
}
```

## Async components

Components can be async. This is how `VectorSearch` works internally. Just return a builder or element wrapped in a promise.

```ts
import { cria } from "@fastpaca/cria";

export async function loadContext() {
  const text = await fetchContext();
  return cria.prompt().region((r) => r.message("assistant", text, { priority: 2 }));
}
```

## Notes for chat renderers

Chat renderers output only `Message` nodes. If you want content to show up in
Chat Completions or Anthropic, make sure it is inside a `Message`.

Avoid nesting `Message` inside `Message` - keep messages as leaf nodes.

## Optional JSX

If you prefer TSX, import from `@fastpaca/cria/jsx` and use components as before; the underlying IR and renderers are the same. The DSL remains the primary API.
