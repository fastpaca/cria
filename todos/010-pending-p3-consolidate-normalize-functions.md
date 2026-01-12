---
status: pending
priority: p3
issue_id: "010"
tags: [code-review, simplification]
dependencies: []
---

# Consolidate normalizeContent/normalizeChild/normalizeChildren

## Problem Statement

There are three separate normalize functions in `src/dsl.ts` with overlapping logic. `normalizeContent` and `normalizeChild` have nearly identical implementations, handling the same types with minor variations.

## Findings

**Location:** `src/dsl.ts` (lines 467-511)

**Evidence:**
```typescript
// normalizeContent handles: string | PromptElement | PromptBuilder
async function normalizeContent(content: string | PromptElement | PromptBuilder): Promise<PromptChildren> {
  if (typeof content === "string") return [content];
  if (content instanceof PromptBuilder) {
    const built = await content.build();
    return [built];
  }
  return [content];
}

// normalizeChild handles: same + Promise<PromptElement> | Promise<string>
async function normalizeChild(child: BuilderChild): Promise<PromptChildren> {
  if (typeof child === "string") return [child];
  if (child instanceof Promise) {
    const resolved = await child;
    if (typeof resolved === "string") return [resolved];
    return [resolved];
  }
  if (child instanceof PromptBuilder) {
    const built = await child.build();
    return [built];
  }
  return [child];
}
```

**Impact:** ~45 lines of similar code that could be ~25 lines.

## Proposed Solutions

### Option A: Merge into Single Function (Recommended)
```typescript
async function normalizeChild(child: BuilderChild): Promise<PromptChild[]> {
  if (typeof child === "string") return [child];
  if (child instanceof Promise) return normalizeChild(await child);
  if (child instanceof PromptBuilder) return [(await child.build())];
  return [child];
}

async function normalizeChildren(children: readonly BuilderChild[]): Promise<PromptChildren> {
  const resolved = await Promise.all(children.map(normalizeChild));
  return resolved.flat();
}
```
- **Pros:** ~20 line reduction, cleaner logic, recursive handling
- **Cons:** Slightly changes internal structure
- **Effort:** Small
- **Risk:** Low

### Option B: Inline resolveContent
- Remove `resolveContent` private method (just calls normalizeContent)
- Keep other functions
- **Pros:** Removes indirection
- **Cons:** Doesn't address main duplication
- **Effort:** Trivial
- **Risk:** None

## Recommended Action

Option A - Consolidate into single recursive normalizeChild function.

## Technical Details

**Affected files:**
- `src/dsl.ts` - normalize functions

**Estimated LOC reduction:** ~14 lines

## Acceptance Criteria

- [ ] Single normalizeChild function handles all BuilderChild types
- [ ] normalizeChildren uses the unified function
- [ ] resolveContent private method removed (inline the call)
- [ ] All DSL tests pass

## Work Log

| Date | Action | Outcome |
|------|--------|---------|
| 2026-01-11 | Created finding from simplicity review | Finding documented |

## Resources

- PR: feat/decouple-jsx branch
