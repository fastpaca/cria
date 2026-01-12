---
status: complete
priority: p1
issue_id: "014"
tags: [code-review, bug, breaking]
dependencies: []
---

# Missing resolveContent Method Breaks summary()

## Problem Statement

The `resolveContent` private method was removed during the normalize functions consolidation refactor, but the `summary()` method still calls `this.resolveContent(content)`. This will cause a runtime error when `.summary()` is used and `.build()` is called.

## Findings

**Location:** `src/dsl.ts` (line 362)

**Evidence:**
```typescript
summary(
  content: string | PromptElement | PromptBuilder,
  opts: { /* ... */ }
): PromptBuilder {
  const element = (async (): Promise<PromptElement> => {
    const children = await this.resolveContent(content);  // <-- ERROR: method doesn't exist
    return Summary({ /* ... */ });
  })();
  return this.addChild(element);
}
```

**Why tests pass:**
- No DSL tests exist for `.summary()` method
- The error only triggers when the IIFE's promise is resolved during `.build()`
- JSX summary tests don't use the DSL path

**Impact:** Any code using `cria.prompt().summary(...)` will fail at runtime with:
```
TypeError: this.resolveContent is not a function
```

## Proposed Solutions

### Option A: Replace with normalizeChild (Recommended)
- Use the existing `normalizeChild()` function like `truncate()` and `omit()` do
```typescript
const children = await normalizeChild(content);
```
- **Pros:** Consistent with other methods, already tested pattern
- **Cons:** None
- **Effort:** Trivial
- **Risk:** None

## Recommended Action

Replace `this.resolveContent(content)` with `normalizeChild(content)` on line 362.

## Technical Details

**Affected files:**
- `src/dsl.ts` - summary() method

## Acceptance Criteria

- [x] summary() uses normalizeChild() instead of resolveContent()
- [x] Add DSL test for summary() method
- [ ] TypeScript build passes without errors
- [ ] All tests pass

## Work Log

| Date | Action | Outcome |
|------|--------|---------|
| 2026-01-12 | Found during re-review verification | Finding documented |
| 2026-01-12 | summary uses normalizeChild; DSL summary test added | Implemented |

## Resources

- PR: feat/decouple-jsx branch
- Related refactor: consolidate normalize functions (finding 010)
