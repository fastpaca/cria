---
status: pending
priority: p3
issue_id: "011"
tags: [code-review, agent-native, dx]
dependencies: []
---

# VectorSearch Throws on Empty Results Instead of Graceful Handling

## Problem Statement

The VectorSearch component throws an error when no results are found. This forces agents and applications to wrap all RAG calls in try/catch for what is an expected condition (no matching documents).

## Findings

**Location:** `src/components/vector-search.ts` (lines 26-29)

**Evidence:**
```typescript
if (results.length === 0) {
  throw new Error("VectorSearch: no results found");
}
```

**Impact:** Agents cannot gracefully handle zero search results. Every use of VectorSearch requires try/catch to handle a non-exceptional case.

## Proposed Solutions

### Option A: Add onEmpty Handler (Recommended)
```typescript
VectorSearch({
  store,
  query,
  onEmpty: () => "No relevant documents found.",  // Optional handler
  // OR
  emptyMessage: "No relevant documents found.",  // Simpler option
})
```
- **Pros:** Flexible, backward-compatible if default throws
- **Cons:** Slightly more complex API
- **Effort:** Small
- **Risk:** Low

### Option B: Return Empty Placeholder
- Return an empty PromptElement or a configurable placeholder message
- **Pros:** Simple
- **Cons:** May hide issues where results are expected
- **Effort:** Small
- **Risk:** Low

### Option C: Document Current Behavior
- Keep throwing, document that try/catch is required
- **Pros:** No code change
- **Cons:** Poor DX for agents
- **Effort:** None
- **Risk:** None

## Recommended Action

Option A with `emptyMessage` option for simplicity.

## Technical Details

**Affected files:**
- `src/components/vector-search.ts`
- `src/dsl.ts` - vectorSearch method options

## Acceptance Criteria

- [ ] VectorSearch accepts `emptyMessage` or `onEmpty` option
- [ ] Empty results return placeholder instead of throwing
- [ ] Default behavior documented
- [ ] Tests added for empty result handling

## Work Log

| Date | Action | Outcome |
|------|--------|---------|
| 2026-01-11 | Created finding from agent-native review | Finding documented |

## Resources

- PR: feat/decouple-jsx branch
