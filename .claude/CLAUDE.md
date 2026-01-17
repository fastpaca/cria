# Cria

A lightweight LLM context and memory layout renderer for enforcing token budgets in long-running agents.

## Style Guide

Follow the TypeScript style guide in [STYLE_GUIDE.md](../STYLE_GUIDE.md). Key points:

- **No `any`** — Use `unknown` and narrow with type guards
- **No enums** — Use `as const` objects with derived union types
- **No parameter mutation** — Return new values
- **Validate at boundaries** — Use Zod for external data, trust refined types internally
- **Use `satisfies`** — For type validation without widening inference
- **Prefer `interface`** — For object types; use `type` for unions/intersections
- **Named exports only** — No default exports
- **Arrow functions** — For callbacks and short functions
- **`for...of`** — Not `.forEach()`
- **kebab-case files** — Enforced by linter

## Commands

```sh
npm run build      # Compile TypeScript
npm run test       # Run tests
npm run check      # Check for lint issues
npm run fix        # Auto-fix formatting and lint issues
```

Run `npm run fix` before committing.
