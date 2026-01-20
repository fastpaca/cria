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
