---
status: complete
priority: p1
issue_id: "015"
tags: [code-review, typescript, build-error]
dependencies: []
---

# Orphaned section() Overload Declaration Breaks TypeScript Build

## Problem Statement

There is an orphaned `section()` overload declaration at line 190 that has no implementation immediately following it. This is a leftover from a refactor and breaks the TypeScript build.

## Findings

**Location:** `src/dsl.ts` (line 190)

**Evidence:**
```typescript
  section(fn: (builder: PromptBuilder) => PromptBuilder): PromptBuilder;  // <-- ORPHANED
  region(fn: (builder: PromptBuilder) => PromptBuilder): PromptBuilder;
  region(
    name: string,
    fn: (builder: PromptBuilder) => PromptBuilder
  ): PromptBuilder;
  region(/* implementation */) {
    // ...
  }
```

**TypeScript Error:**
```
src/dsl.ts(190,3): error TS2391: Function implementation is missing or not immediately following the declaration.
```

**Impact:** TypeScript build fails. This line appears to be a leftover from the JSDoc comment above it or from a merge.

## Proposed Solutions

### Option A: Remove the Orphaned Line (Recommended)
- Delete line 190
- The `section()` method has its proper overloads at lines 223-227
- **Pros:** Simple fix
- **Cons:** None
- **Effort:** Trivial
- **Risk:** None

## Recommended Action

Delete line 190: `section(fn: (builder: PromptBuilder) => PromptBuilder): PromptBuilder;`

## Technical Details

**Affected files:**
- `src/dsl.ts` - Line 190

## Acceptance Criteria

- [x] Orphaned declaration removed
- [ ] TypeScript build passes
- [ ] All tests pass

## Work Log

| Date | Action | Outcome |
|------|--------|---------|
| 2026-01-12 | Found during re-review verification | Finding documented |
| 2026-01-12 | Removed stray overload before region implementation | Implemented |

## Resources

- PR: feat/decouple-jsx branch
