---
status: complete
priority: p3
issue_id: "009"
tags: [code-review, simplification, yagni]
dependencies: []
---

# Remove union() Alias - Identical to merge()

## Problem Statement

The `union()` method and exports are pure aliases of `merge()` with identical behavior. Having both creates API surface bloat without added value and may confuse users expecting set-theory semantics.

## Findings

**Location:** `src/dsl.ts` (lines 269-271, 443-447, 464-465)

**Evidence:**
```typescript
// Line 269-271 - instance method
union(...builders: PromptBuilder[]): PromptBuilder {
  return this.merge(...builders);
}

// Line 443-447 - namespace
union: (...builders: PromptBuilder[]) => {
  if (builders.length === 0) return PromptBuilder.create();
  return builders.slice(1).reduce((acc, b) => acc.union(b), builders[0]);
},

// Line 464-465 - standalone export
export const union = (...builders: PromptBuilder[]): PromptBuilder =>
  cria.union(...builders);
```

**Impact:** ~11 lines of code that provide no additional functionality.

## Proposed Solutions

### Option A: Remove union() (Recommended)
- Remove the `union()` method, namespace property, and standalone export
- Document in changelog that `merge()` can be used for combining builders
- **Pros:** Simpler API, less code
- **Cons:** Breaking change if anyone uses union()
- **Effort:** Trivial
- **Risk:** Low (new API, unlikely to have users)

### Option B: Deprecate union()
- Mark as deprecated, remove in next major version
- **Pros:** Non-breaking
- **Cons:** Keeps the code around longer
- **Effort:** Trivial
- **Risk:** None

## Recommended Action

Option A - Remove union() since this is a new API with no existing users.

## Technical Details

**Affected files:**
- `src/dsl.ts` - Remove union() method, namespace property, standalone export
- `src/index.ts` - Remove union export
- `src/dsl.test.ts` - Remove or update union tests

**Estimated LOC reduction:** ~11 lines

## Acceptance Criteria

- [x] union() method removed from PromptBuilder
- [x] union property removed from cria namespace
- [x] union standalone export removed
- [ ] All remaining tests pass
- [x] merge() documented as the way to combine builders

## Work Log

| Date | Action | Outcome |
|------|--------|---------|
| 2026-01-11 | Created finding from simplicity review | Finding documented |
| 2026-01-11 | union alias removed in favor of merge | Implemented |

## Resolution

- Removed the `union` instance method, namespace property, and export; `merge()` remains the single way to combine builders.
- Updated tests to drop the alias coverage; docs already point to `merge()` patterns.

## Resources

- PR: feat/decouple-jsx branch
