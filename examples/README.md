# Examples

DSL-first examples live in each integration folder's main file. JSX variants have been moved under `examples/jsx/` for reference only.

- Start with `docs/quickstart.md`, then pick a task guide from `docs/README.md`.

- DSL (preferred): see `examples/*/` with `main.ts` or equivalent.
- JSX (optional): see `examples/jsx/*.tsx` and import `@fastpaca/cria/jsx` if you want TSX syntax.

Use the DSL unless you explicitly need JSX syntax. Both surfaces produce the same PromptElement IR and renderers.
