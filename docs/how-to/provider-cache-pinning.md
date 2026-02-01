# Provider cache pinning

Provider cache pinning lets you mark a **stable prompt prefix** so a provider can reuse KV/cache across runs. The goal is to avoid re-processing the same system instructions and static context on every request.

This is a **hint**. Providers may ignore it, cache hits can expire, and savings depend on how much of your prompt is truly stable.

## How to use it

Pin the prefix once, then keep chaining to add the unpinned tail:

```ts
import { cria } from "@fastpaca/cria";

const prompt = cria
  .prompt()
  .system("You are a helpful assistant.")
  .system("Policy v3: ...")
  .pin({ id: "rules", version: "v3", scopeKey: "tenant:acme", ttlSeconds: 3600 })
  .user(userQuestion);
```

You can also build a pinned prefix once and reuse it:

```ts
const pinnedPrefix = cria
  .prompt()
  .system("You are a helpful assistant.")
  .system("Policy v3: ...")
  .pin({ id: "rules", version: "v3", scopeKey: "tenant:acme", ttlSeconds: 3600 });

const prompt = cria
  .prompt()
  .prefix(pinnedPrefix)
  .user(userQuestion);
```

### Pass render context explicitly

Cache hints are passed through the render context. When you call a provider
directly, use `renderWithContext` and pass the context to the provider:

```ts
const { output, context } = await prompt.renderWithContext();
await provider.completion(output, context);
```

### Rules to remember

- `.pin()` can only be used once per prompt.
- The pin always refers to the **current prompt prefix**.
- A pinned builder must be first. Merging a pinned builder **after** unpinned content throws.
- Use `id` + `version` to control cache keys explicitly.

## Provider behavior

Cria exposes a provider-agnostic cache descriptor during render. Providers translate it into their native hints:

- **OpenAI**: `prompt_cache_key` is derived from the pin `id` + `version`.
- **Anthropic**: `cache_control` is applied to the pinned system prefix blocks.

Providers may ignore these hints or apply different cache rules. Pinning works best when your prefix is stable and versioned.

## Estimating savings (rule of thumb)

Savings scale with how much of the **prompt input** is cached. A simple estimate:

```ts
const promptTokens = usage?.prompt_tokens ?? 0;
const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;
const cachedPercent = promptTokens > 0 ? (cachedTokens / promptTokens) * 100 : 0;
```

**Rule of thumb:** if ~80% of your prompt tokens are cached, you can often expect **~80% input-token savings** on providers that discount cached reads. Output tokens are unaffected.

For example, if you pin a 1200-token prefix in a 1500-token prompt, the cached fraction is ~80%. If the provider discounts cached input, the input cost typically drops by roughly that fraction.

If the provider exposes cost fields in `usage`, prefer those over estimates.

## Runnable example

- [Provider cache pinning example](../../examples/provider-cache-pinning)

```bash
cd examples/provider-cache-pinning
pnpm install
pnpm start
```

This example uses **OpenAI chat completions only**. It pins a large system prefix,
reuses it across requests, and throws if the `prompt_cache_key` wiring is not
stable for pinned prefixes or missing for unpinned prompts.
