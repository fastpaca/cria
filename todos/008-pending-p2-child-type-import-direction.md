---
status: pending
priority: p2
issue_id: "008"
tags: [code-review, architecture]
dependencies: []
---

# Cross-boundary Import: Components Import Child Type from JSX Runtime

## Problem Statement

The components module imports the `Child` type from `jsx-runtime.ts`, creating a subtle dependency where core components depend on the optional JSX surface. While it's a type-only import with no runtime impact, it contradicts the "JSX is optional" narrative and creates conceptual coupling.

## Findings

**Location:** `src/components/index.ts` (line 1)

**Evidence:**
```typescript
import type { Child } from "../jsx-runtime";
```

**Impact:** The core components module has a conceptual dependency on the JSX runtime. This is technically fine (type-only imports are erased at runtime), but architecturally confusing since JSX is marketed as optional.

## Proposed Solutions

### Option A: Define Child in Core Types (Recommended)
- Move `Child` type definition to `src/types.ts`
- Re-export from `src/jsx/jsx-runtime.ts`
- Inverts the dependency direction
```typescript
// src/types.ts
export type PromptChild = PromptElement | string;
export type Child = PromptChild | number | boolean | null | undefined | readonly Child[];

// src/jsx/jsx-runtime.ts
export type { Child } from "../types";
```
- **Pros:** Clean dependency direction, JSX truly optional
- **Cons:** Minor refactor
- **Effort:** Small
- **Risk:** Low

### Option B: Duplicate the Type
- Define `Child` separately in components
- **Pros:** No cross-module dependency
- **Cons:** Duplication
- **Effort:** Trivial
- **Risk:** Low (types may drift)

### Option C: Document as Intentional
- Keep current structure, document it's type-only
- **Pros:** No code change
- **Cons:** Doesn't fix the conceptual issue
- **Effort:** None
- **Risk:** None

## Recommended Action

Option A - Move Child type to core types and re-export from JSX.

## Technical Details

**Affected files:**
- `src/types.ts` - Add Child type definition
- `src/components/index.ts` - Update import
- `src/jsx/jsx-runtime.ts` - Re-export from types

## Acceptance Criteria

- [ ] Child type defined in core types.ts
- [ ] jsx-runtime.ts re-exports Child from types.ts
- [ ] Components import Child from types.ts
- [ ] All tests pass

## Work Log

| Date | Action | Outcome |
|------|--------|---------|
| 2026-01-11 | Created finding from architecture review | Finding documented |

## Resources

- PR: feat/decouple-jsx branch
