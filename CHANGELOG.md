## [1.7.3](https://github.com/fastpaca/cria/compare/v1.7.2...v1.7.3) (2026-02-06)


### Bug Fixes

* **eval:** use cria namespace ([9f90232](https://github.com/fastpaca/cria/commit/9f9023281cd8c2ee58d4771f0c7b92b88d93d02c))


### Features

* **dsl:** add prompt plugins and user-scoped stores ([d06295a](https://github.com/fastpaca/cria/commit/d06295a32c522ab7cec0b8dd0fe853c8c09fab51))
* **dsl:** add summarizer/vectordb components ([ced2f93](https://github.com/fastpaca/cria/commit/ced2f93ce43577c1d1aabf509204582f6d10c7fe))
* **memory:** tighten prompt-plugin boundaries and tests ([d292606](https://github.com/fastpaca/cria/commit/d2926066e4802512aaa3528f2b1564df46e03dc5))

## [1.7.2](https://github.com/fastpaca/cria/compare/v1.7.1...v1.7.2) (2026-02-03)


### Bug Fixes

* add back package-lock.json for releases ([#44](https://github.com/fastpaca/cria/issues/44)) ([53e29b8](https://github.com/fastpaca/cria/commit/53e29b8e2d1779af2371a368554be1a5ece5806b))
* **memory:** adjust sqlite vector cast ([58fbf3e](https://github.com/fastpaca/cria/commit/58fbf3e1a36be0b00a17d89ee7f4d0ab8a96ed84))
* **memory:** align sqlite vector row typing ([d0e8972](https://github.com/fastpaca/cria/commit/d0e89728f5a39cadc32760f037406a6c74bd2165))
* **memory:** use libsql vector distance ([7a9b4d8](https://github.com/fastpaca/cria/commit/7a9b4d8163f241e53f93666a7412db2c18284efd))
* **release:** sync package-lock.json before npm clean-install ([9eaa448](https://github.com/fastpaca/cria/commit/9eaa44828eb9985a6dec5c5027c52cf7bcd1663a))


### Features

* **memory:** add libsql vector store ([05c44ac](https://github.com/fastpaca/cria/commit/05c44acc9f0e2076c9b34f29b598454c561f84ed))
* **memory:** add zod schema to sqlite vector ([a114590](https://github.com/fastpaca/cria/commit/a11459025af3d5e20d6428139c11bba1b7f4ccb0))

## [1.7.1](https://github.com/fastpaca/cria/compare/v1.7.0...v1.7.1) (2026-02-02)


### Bug Fixes

* **build:** add better-sqlite3 types ([c1b6777](https://github.com/fastpaca/cria/commit/c1b677791c98315b43cd16d3603c81be76052eba))
* **memory:** bind sqlite-vec rowids ([a586c2a](https://github.com/fastpaca/cria/commit/a586c2a43cde19c46dd99fefd55f1b0cbc86c00c))
* **types:** align sqlite options ([3de8e1d](https://github.com/fastpaca/cria/commit/3de8e1df3e662d8ea98cec9639b24202dc419c28))


### Features

* **examples:** add sqlite stores example ([deef110](https://github.com/fastpaca/cria/commit/deef110bc558eac981745d31f2d92aa91ae205f1))
* **memory:** add sqlite store ([0b356a4](https://github.com/fastpaca/cria/commit/0b356a4b31d8228855d29691761ae47ffa472120))
* **memory:** add sqlite vec adapter ([3d2bfb5](https://github.com/fastpaca/cria/commit/3d2bfb512aca0a3e445fd9cb0bb3ebe2fa71b280))

# [1.7.0](https://github.com/fastpaca/cria/compare/v1.6.0...v1.7.0) (2026-02-01)


### Features

* provider cache pinning ([#30](https://github.com/fastpaca/cria/issues/30)) ([297a939](https://github.com/fastpaca/cria/commit/297a939c5da7a657666dae36cdfe9a3494544ad7))

# [1.6.0](https://github.com/fastpaca/cria/compare/v1.5.0...v1.6.0) (2026-01-23)


### Bug Fixes

* **examples:** align OpenAI and zod versions across examples ([6331845](https://github.com/fastpaca/cria/commit/63318456f98aecd1d9cd87af7f0ebc1f7f781fdf))
* update dependencies for zod 4 compatibility ([bcf95d7](https://github.com/fastpaca/cria/commit/bcf95d74bfb598bf8071f2886c2ef5c35bd38057))


### Features

* **dsl:** add .last() method for keeping last N messages ([122ca7c](https://github.com/fastpaca/cria/commit/122ca7c88ded89dac4367fb219e4e17828e142a2))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-01-20

### Added

- `when()` conditional helper for including content based on runtime conditions.
- `merge()` utility for combining multiple prompts into one.

### Removed

- JSX support from core package (moved to optional `@fastpaca/cria/jsx` entry).

## [1.4.0] - 2026-01-18

### Added

- Prompt evaluation module (`@fastpaca/cria/eval`) with LLM-as-a-judge pattern.
- `createJudge()` fluent API for testing prompts against quality criteria.
- Built-in criterion templates for common evaluation patterns.

## [1.3.0] - 2026-01-14

### Added

- `Prompt` type alias for cleaner composable prompt sections.

### Changed

- Hoisted tiktoken encoder instantiation outside tokenizer functions for better performance.

## [1.2.0] - 2026-01-14

### Added

- Enriched error messages with guidance on how to fix common issues.
- Fit diagnostics for debugging token budget problems.

### Changed

- DSL is now the primary API surface; all docs and examples converted to DSL-first.
- JSX moved to optional entry point (`@fastpaca/cria/jsx`).
- Parallelized child normalization for faster prompt building.

### Fixed

- PostgreSQL table name sanitization to prevent SQL injection.
- Empty vector search results now handled gracefully.

## [1.0.0] - 2026-01-11

### Added

- Fluent DSL API for building prompts with `cria.prompt()`, `.system()`, `.user()`, `.assistant()`, `.tool()` builders.
- Template literals with the `c` tag for interpolating variables into messages.
- Provider integrations for AI SDK, OpenAI, and Anthropic with native message format rendering.
- Token counting with provider-owned tokenizers defaulting to tiktoken.
- Memory module with `KVMemory` interface for key-value storage.
- Redis and PostgreSQL adapters for persistent key-value memory.
- VectorSearch component for RAG patterns with semantic retrieval.
- ChromaDB and Qdrant adapters for vector similarity search.
- Summary component for automatic conversation summarization.
- OpenTelemetry hooks for observability and instrumentation.

## [0.0.1] - 2025-12-31

### Added

- Initial release with basic prompt rendering.
- Token budget support for constraining prompt size.
- AI SDK integration example.
