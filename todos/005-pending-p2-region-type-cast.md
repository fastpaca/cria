---
status: pending
priority: p2
issue_id: "005"
tags: [code-review, typescript, quality]
dependencies: []
---

# Dangerous Type Cast in region() Method Delegation

## Problem Statement

The `region()` method delegates to `section()` using `as never` type casts, which bypasses TypeScript's type checking and hides potential issues. This also obscures the API and could lead to silent failures.

## Findings

**Location:** `src/dsl.ts` (lines 190-201)

**Evidence:**
```typescript
region(
  nameOrFn: string | ((builder: PromptBuilder) => PromptBuilder),
  maybeFn?: (builder: PromptBuilder) => PromptBuilder
): PromptBuilder {
  return this.section(nameOrFn as never, maybeFn as never);  // Dangerous casts
}
```

**Issues:**
1. The `as never` casts are dangerous and hide type errors
2. The overload pattern is confusing and duplicated between section/region
3. There's a latent bug: `.region(fn, { priority: 0 })` silently ignores the options object

**Related Bug Found:** The test at `src/render.dsl.test.ts:53` passes `{ priority: 0 }` as a second argument to `.region()`, but the current overloads do not support an options object. The test passes coincidentally.

## Proposed Solutions

### Option A: Shared Private Implementation (Recommended)
- Create a private implementation method that both section and region call
- Remove type casts entirely
```typescript
private _section(
  name: string | undefined,
  fn: (builder: PromptBuilder) => PromptBuilder
): PromptBuilder {
  // Implementation here
}

section(fn: (builder: PromptBuilder) => PromptBuilder): PromptBuilder;
section(name: string, fn: (builder: PromptBuilder) => PromptBuilder): PromptBuilder;
section(nameOrFn: string | ((builder: PromptBuilder) => PromptBuilder), maybeFn?: ...): PromptBuilder {
  const name = typeof nameOrFn === "string" ? nameOrFn : undefined;
  const fn = typeof nameOrFn === "string" ? maybeFn! : nameOrFn;
  return this._section(name, fn);
}

region = this.section.bind(this);  // Simple alias
```
- **Pros:** Clean, type-safe, no casts
- **Cons:** Slightly more code
- **Effort:** Small
- **Risk:** Low

### Option B: Deprecate region()
- Keep only `section()`, deprecate `region()`
- **Pros:** Simpler API
- **Cons:** Breaking change for any existing usage
- **Effort:** Trivial
- **Risk:** Medium (API change)

## Recommended Action

Option A - Create shared private implementation and remove type casts.

## Technical Details

**Affected files:**
- `src/dsl.ts` - region() and section() methods

## Acceptance Criteria

- [ ] No `as never` casts in the codebase
- [ ] region() properly delegates to shared implementation
- [ ] Test at render.dsl.test.ts:53 is fixed or overloads support options
- [ ] All tests pass

## Work Log

| Date | Action | Outcome |
|------|--------|---------|
| 2026-01-11 | Created finding from pattern & TypeScript review | Finding documented |

## Resources

- PR: feat/decouple-jsx branch
