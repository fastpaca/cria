---
status: complete
priority: p2
issue_id: "007"
tags: [code-review, agent-native, dx]
dependencies: []
---

# Error Messages Need DSL-Specific Guidance for Agent Self-Correction

## Problem Statement

Several error messages reference JSX syntax but don't mention the DSL equivalent. AI agents using the DSL cannot self-correct based on JSX-only instructions.

## Findings

**Location 1:** `src/components/summary.ts` (lines 101-103)

**Evidence:**
```typescript
throw new Error(
  `Summary "${id}" requires either a 'summarize' function or a provider component ancestor (e.g. <AISDKProvider>)`
);
```

The error references `<AISDKProvider>` (JSX) but doesn't mention the DSL `.provider()` method.

**Location 2:** `src/dsl.ts` (lines 228-229)

**Evidence:**
```typescript
if (!fn) {
  throw new Error("section() requires a callback function");
}
```

Doesn't tell the agent what was actually passed.

**Location 3:** `src/types.ts` (lines 284-298)

**Evidence:**
```typescript
throw new Error(
  `Cannot fit prompt: ${overBudgetBy} tokens over budget at priority ${priority} (iteration ${iteration})`
);
```

Doesn't include the current total tokens or budget, which agents need to restructure prompts.

## Proposed Solutions

### Option A: Comprehensive Error Message Updates (Recommended)
- Update all error messages to include both DSL and JSX guidance
- Include diagnostic information (what was passed, current state)
- **Pros:** Enables agent self-correction
- **Cons:** Slightly longer error messages
- **Effort:** Small
- **Risk:** None

**Example improvements:**
```typescript
// Summary error
`Summary "${id}" requires either a 'summarize' function or a provider scope.
DSL: .provider(new Provider(model), (p) => p.summary(...))
JSX: <AISDKProvider model={...}>...</AISDKProvider>`

// section() error
`section() requires a callback function, but received: ${typeof nameOrFn}`

// FitError
`Cannot fit prompt: ${totalTokens} tokens exceeds budget of ${budget} by ${overBudgetBy} at priority ${priority} (iteration ${iteration})`
```

## Recommended Action

Update all user-facing error messages to include actionable guidance for both DSL and JSX surfaces.

## Technical Details

**Affected files:**
- `src/components/summary.ts`
- `src/dsl.ts`
- `src/types.ts` (FitError class)
- `src/components/vector-search.ts` (empty results error)

## Acceptance Criteria

- [x] All error messages include DSL-specific guidance
- [x] FitError includes budget and totalTokens
- [x] Error messages tell user what was actually passed
- [x] Documentation reflects error message format

## Work Log

| Date | Action | Outcome |
|------|--------|---------|
| 2026-01-11 | Created finding from agent-native review | Finding documented |
| 2026-01-11 | Error messages updated with DSL/JSX guidance + diagnostics | Implemented |

## Resolution

- Summary component error now points to both DSL `.provider()` usage and JSX provider wrapping.
- `section()`/`region()` errors report the received type and an example DSL usage.
- `FitError` captures `budget` and `totalTokens` and surfaces them in the error message; docs updated with the new fields.

## Resources

- PR: feat/decouple-jsx branch
