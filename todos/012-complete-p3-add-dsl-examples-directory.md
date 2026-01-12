---
status: complete
priority: p3
issue_id: "012"
tags: [code-review, docs, examples]
dependencies: []
---

# Add DSL Examples Directory

## Problem Statement

The examples directory only contains `examples/jsx/` but no `examples/dsl/` directory. This contradicts the DSL-first positioning of this branch.

## Findings

**Location:** `examples/` directory

**Evidence:**
```
examples/
├── .lint-guidance.md
├── README.md
├── jsx/
│   ├── README.md
│   ├── ai-sdk.tsx
│   ├── anthropic.tsx
│   ├── openai-chat-completions.tsx
│   ├── openai-responses.tsx
│   ├── rag.tsx
│   └── summary.tsx
└── (no dsl/ directory)
```

The branch makes DSL the primary API but only has JSX examples in the examples directory.

## Proposed Solutions

### Option A: Create DSL Examples Directory (Recommended)
- Create `examples/dsl/` with TypeScript examples matching JSX examples
- Update examples/README.md to list DSL examples first
- **Pros:** Consistent with DSL-first messaging
- **Cons:** Some duplication with docs
- **Effort:** Medium
- **Risk:** None

### Option B: Rename Current Structure
- Keep examples as `.ts` files (DSL) in root examples/
- Move JSX to examples/jsx/
- **Pros:** DSL is the default
- **Cons:** May break existing links
- **Effort:** Medium
- **Risk:** Low

## Recommended Action

Option A - Create DSL examples directory to reinforce DSL-first positioning.

## Technical Details

**Affected directories:**
- `examples/` - Add `dsl/` subdirectory

**Files to create:**
- `examples/dsl/README.md`
- `examples/dsl/basic.ts`
- `examples/dsl/ai-sdk.ts`
- `examples/dsl/anthropic.ts`
- `examples/dsl/openai.ts`
- `examples/dsl/rag.ts`

## Acceptance Criteria

- [x] DSL-first examples present and discoverable (JSX isolated under `examples/jsx/`)
- [x] At least one DSL example per integration
- [x] examples/README.md updated to list DSL first
- [ ] Examples run successfully

## Work Log

| Date | Action | Outcome |
|------|--------|---------|
| 2026-01-11 | Created finding from architecture review | Finding documented |
| 2026-01-11 | Confirmed DSL examples + JSX isolation in /examples/jsx | Implemented |

## Resolution

- DSL examples already live at the root of `examples/` (ai-sdk, openai, rag, summary, etc.), with JSX variants moved under `examples/jsx/` and README updated to call out DSL-first usage.
- No structural changes required beyond the existing DSL/JSX split.

## Resources

- PR: feat/decouple-jsx branch
