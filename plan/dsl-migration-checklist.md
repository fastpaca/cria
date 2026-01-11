# DSL-First Migration Checklist

Tracking all spots that still assume JSX-first or need updates to reflect the DSL as the primary surface. Check items off as they are updated.

## Docs (public-facing)
- [x] README.md: rewrite intro tagline (currently “JSX prompt composition”), lead with DSL examples; move JSX to “optional” section; update roadmap “Done” bullet mentioning JSX runtime.
- [x] docs/README.md: change framing from “prompts as JSX components” to “DSL builder”; add note that JSX is optional via `@fastpaca/cria/jsx`.
- [x] docs/quickstart.md: replace JSX setup and examples with DSL `.prompt().render(...)`; add short note on optional JSX runtime config for those who need it.
- [x] docs/concepts.md: adjust “Your JSX compiles…” phrasing to “Builder produces IR”; keep a sidebar for JSX translation.
- [x] docs/custom-components.md: add DSL-based custom builder patterns; move JSX sample to optional section.
- [x] docs/integrations/*.md: ensure code snippets use DSL; add one-liner on JSX entry path.
- [x] docs/strategies.md: swap JSX samples for DSL chains; ensure render calls use `.render()` convenience.
- [x] docs/errors.md / observability / recipes: swap JSX samples for DSL chains.
- [x] Any docs mentioning “configure JSX runtime” need DSL-first wording and optional JSX appendix.

## Examples
- [x] examples/ai-sdk/main.tsx: convert to DSL entrypoint.
- [x] examples/openai-*/anthropic/etc.: main usage shows `cria.prompt()` chains with `.render()`.
- [ ] Add a minimal DSL-only example for each integration; move JSX versions under a clearly marked `jsx/` subfolder or README note (pending).

## Source comments and docs
- [x] src/index.ts header comment references “JSX-based prompt renderer”; rewrite to DSL-first and mention JSX optional entry.
- [x] src/render.ts comment about “The JSX runtime normalizes children…”: update to “builder/JSX produce PromptElement; render awaits root value” (include both surfaces).
- [x] src/types.ts comment “after JSX normalization”: broaden to “after child normalization”.
- [ ] src/dsl.test.ts “equivalence with JSX” block: keep but ensure intent (compatibility) is documented; optionally add DSL-only golden tests.
- [x] Provider docs/types: document new Provider classes (OpenAI/Anthropic/AI SDK) for `.provider()` in DSL.

## Config/exports
- [x] tsconfig.json: remove default `jsxImportSource` for core/examples; DSL is default, JSX is optional entry.
- [ ] package.json exports: verify JSX optional entry messaging in README; consider deprecating root JSX exports in a future major (add TODO/release note).
- [ ] Ensure `@fastpaca/cria/jsx` path is documented; optionally add `package.json` `"typesVersions"` hint if needed.

## Tests and tooling
- [ ] Add DSL-focused examples/tests mirroring prior JSX snapshot/fit tests (render.test.tsx currently JSX-based).
- [ ] Add a small compatibility test to import `@fastpaca/cria/jsx` runtime to ensure optional entry works after build.
- [ ] Consider snapshot tests for DSL chains to lock behavior (esp. async components like VectorSearch/Summary).

## Nice-to-haves
- [ ] Provide a DSL recipe for common patterns (system/context/ask) to replace JSX snippets across docs.
- [ ] Add lint/example that enforces DSL in examples (or at least documents preferred style).
