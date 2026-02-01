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
