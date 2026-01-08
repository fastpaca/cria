# Custom components

Cria components are just functions that return prompt elements. You can build
reusable blocks the same way you build UI components.

## Basic pattern

```tsx
import type { PromptElement } from "@fastpaca/cria";

type SystemProps = { children: string };

export function System({ children }: SystemProps): PromptElement {
  return {
    kind: "message",
    role: "system",
    priority: 0,
    children: [children],
  };
}
```

## Composed component

```tsx
import { Message, Region } from "@fastpaca/cria";

type ContextBlockProps = {
  title: string;
  children: string;
};

export function ContextBlock({ title, children }: ContextBlockProps) {
  return (
    <Region priority={2}>
      <Message messageRole="assistant">
        {title}\n{children}
      </Message>
    </Region>
  );
}
```

## Async components

Components can be async. This is how `VectorSearch` works.

```tsx
export async function LoadContext() {
  const text = await fetchContext();
  return <Region priority={2}>{text}</Region>;
}
```

## Notes for chat renderers

Chat renderers output only `Message` nodes. If you want content to show up in
Chat Completions or Anthropic, make sure it is inside a `Message`.

Avoid nesting `Message` inside `Message` - keep messages as leaf nodes.
