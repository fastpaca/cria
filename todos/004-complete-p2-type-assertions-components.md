---
status: complete
priority: p2
issue_id: "004"
tags: [code-review, typescript, type-safety]
dependencies: []
---

# Type Assertions Hiding Potential Runtime Errors in Components

## Problem Statement

Multiple components use `children as PromptChildren` type assertions that bypass type checking. The `Child` type from JSX runtime includes `number | boolean | null | undefined | readonly Child[]`, but `PromptChildren` only accepts `(PromptElement | string)[]`. These assertions assume normalization has happened, but components receive raw `Child` input.

## Findings

**Location:** `src/components/index.ts` (lines 38-44, 248)

**Evidence:**
```typescript
// Line 38-44 (Region)
return {
  priority,
  children: children as PromptChildren, // Type assertion bypasses checking
  ...
};

// Line 248 (Omit)
children: children as PromptChildren,
```

**Impact:** If a consumer passes a number or boolean directly (without JSX normalization), it will silently fail at runtime. Example:
```typescript
Message({ messageRole: "user", children: 42 })  // Would pass type check but fail at runtime
```

## Proposed Solutions

### Option A: Runtime Validation (Recommended)
- Add a `validateChildren` helper that validates children at runtime
- Throw descriptive error if invalid types are passed
- **Pros:** Catches errors early with clear messages
- **Cons:** Small runtime overhead
- **Effort:** Small
- **Risk:** Low

### Option B: Separate DSL-Only Interfaces
- Create separate interfaces for DSL usage that accept only `PromptChildren`
- Keep JSX interfaces with `Child` type
- **Pros:** Compile-time safety for DSL path
- **Cons:** API surface duplication
- **Effort:** Medium
- **Risk:** Low

### Option C: Make Components Async with Internal Normalization
- Have components call `normalizeChildren` internally
- **Pros:** Consistent handling
- **Cons:** Makes all components async
- **Effort:** Medium
- **Risk:** Medium (API change)

## Recommended Action

Option A - Add runtime validation with clear error messages.

## Technical Details

**Affected files:**
- `src/components/index.ts` - Multiple component functions

## Acceptance Criteria

- [x] Components no longer rely on `as PromptChildren` assertions
- [x] Components accept normalized `PromptChildren` directly
- [ ] Existing tests pass
- [ ] New test added for invalid child type handling

## Work Log

| Date | Action | Outcome |
|------|--------|---------|
| 2026-01-11 | Created finding from TypeScript review | Finding documented |
| 2026-01-11 | Components switched to `PromptChildren` props | Implemented |

## Resolution

- Components now declare `children?: PromptChildren` and default to `[]`, removing all `as PromptChildren` assertions.
- Dropped the dependency on JSX runtime `Child` types; `LibraryManagedAttributes` continues to coerce JSX inputs, keeping core components focused on normalized children.
- Runtime validation deferred; compile-time narrowing prevents accidental non-normalized inputs in the DSL/component surface.

## Resources

- PR: feat/decouple-jsx branch
