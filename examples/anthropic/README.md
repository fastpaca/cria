# Cria + Anthropic Example

This example shows how to use Cria with the Anthropic API.

## Setup

```bash
pnpm install
```

## Run

Assumes `ANTHROPIC_API_KEY` is set in your environment.

```bash
pnpm start
```

## Notes

The Anthropic renderer automatically extracts system messages to the separate
`system` parameter required by the Anthropic API.
