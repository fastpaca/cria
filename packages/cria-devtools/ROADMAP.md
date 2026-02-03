# Cria DevTools Roadmap and Spec

Purpose
- Make prompt execution inspectable end-to-end: payload, compaction, tool I/O, model response, timing, and cost.
- Stay local-first, work with OTLP, and keep the server lightweight.

Audience
- Developers debugging prompt composition, fit/compaction, tool calls, and model responses.
- Teams validating prompt changes and regressions.

Current State (what exists)
- Local HTTP server with OTLP ingest and SSE stream.
- Session list with before/after payload snapshots.
- Inline and split diff views.
- Tool call/result grouping and JSON viewer.
- Basic session metadata (budget, tokens, duration, iterations, error).

Core Value Proposition
- Show the exact payload sent to the model and how compaction changed it, locally, without a SaaS.

Goals
- Make sessions durable and shareable.
- Make debugging faster with better search, token breakdown, and compaction rationale.
- Add correlation to model responses and cost.
- Provide timing visibility and workflow-level insights.

Non-Goals
- Replacing full APM or tracing systems.
- Hosting or storing data remotely.
- Opinionated prompt authoring UI.

Success Metrics
- Time to answer "why did this prompt exceed budget?" < 2 minutes.
- 80% of users can find a specific message or tool call via search.
- 50% reduction in manual diff/inspection steps vs. today.

Roadmap

Phase 0: Stabilize and Document
- Add "How to run DevTools" docs with OTLP config example.
- Update README status from planned to beta.
- Provide a simple "send test trace" helper in examples.
- Add small UI hints for empty state and connection.

Phase 1: Durability and Export
- Persist sessions to disk with simple retention policy.
- Export session JSON and payload-only JSON.
- Add basic import/replay for saved sessions.
- Add session tags and notes.

Phase 2: Search and Deep Inspect
- Full-text search across message text, tool input/output, and errors.
- Advanced filters (status, budget range, tokens delta, service, trace id).
- Per-message token breakdown and per-scope token contribution.
- "Why removed" compaction rationale panel per message/scope.

Phase 3: Response and Cost Correlation
- Attach model responses to sessions (prompt + response).
- Capture provider request/response metadata (model, params, latency).
- Cost estimation per session and per message scope.

Phase 4: Timing and Flow
- Visual timeline view: session span, iterations, prompt phases.
- Waterfall view for prompt building and model call.
- Compare sessions or baselines for regressions.

Spec Details

1) Persistence
Problem
- Sessions disappear (TTL, maxSessions), preventing analysis later.

Proposal
- Add a small store that writes sessions to disk as JSONL or SQLite.
- Configurable retention: max sessions and max age.
- Keep in-memory list for fast UI, hydrate from disk on start.

Design
- New option: dataDir, retentionDays, retentionCount.
- Server: persist on SessionStore.upsert.
- API: add GET /cria/devtools/sessions?source=memory|disk and GET /cria/devtools/session/:id.

2) Export and Import
Problem
- Hard to share or compare sessions.

Proposal
- Export button in UI: session JSON, payload-only, and diff-only.
- Import/replay from file to local UI (no server write required).

Design
- UI uses File System Access API with fallback download.
- Add small "import sessions" drop target in empty state.

3) Search and Filters
Problem
- Search is limited to ids/labels.

Proposal
- Full-text search across message text, tool input/output, and error.
- Filters for status, budget, token delta, duration, initiator, service.

Design
- In-memory inverted index for small local data.
- Keep a "searchableText" field in persisted sessions.
- UI: filter drawer + chips.

4) Token Breakdown
Problem
- Only total tokens are visible.

Proposal
- Show tokens per message and per scope (before/after).
- Highlight largest contributors and removed messages.

Design
- Extend render hooks to emit token counts per message/scope.
- Display as per-message badges and a "Top tokens" list.

5) Compaction Rationale
Problem
- Diff shows what changed but not why.

Proposal
- Annotate removed messages with reason (priority, strategy, phase).
- Show fit loop decisions in a structured panel.

Design
- Extend strategy events to include target scope and decision details.
- UI: "Why removed" chips in diff and details view.

6) Response and Cost Correlation
Problem
- Prompt payload is visible but response is not.

Proposal
- Capture model response in the trace and render it alongside prompt.
- Estimate cost using model + token pricing config.

Design
- Extend OpenAI provider hooks to emit response message and usage.
- Add pricing config to DevTools UI (local config file).

7) Timing Visualization
Problem
- Timing data exists but is not visible.

Proposal
- Timeline/rail view with prompt phases and iterations.

Design
- Use existing timing events in session payload.
- UI: small timeline bar in session header, detailed view in Diff tab.

8) Security
Problem
- DevTools server is open by default.

Proposal
- Add optional auth token.
- Bind to localhost by default (keep).

Design
- Require header `x-cria-devtools-token` when configured.
- UI prompts for token if missing.

Deliverables and Owners
- Each phase should land with docs, example, and tests.
- All new fields must be backward compatible and optional.

Risks and Mitigations
- OTLP payload size: add max body config and graceful errors.
- Token breakdown accuracy: document differences between providers.
- Response capture privacy: opt-in by default.

Open Questions
- Preferred storage format (JSONL vs SQLite)?
- Should response capture live in Cria core or DevTools only?
- How should pricing be configured for on-prem/local use?
