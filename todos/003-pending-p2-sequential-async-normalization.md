---
status: pending
priority: p2
issue_id: "003"
tags: [code-review, performance, async]
dependencies: []
---

# Sequential Async Resolution in normalizeChildren

## Problem Statement

The `normalizeChildren` function awaits each child sequentially in a for loop. For prompts with multiple async components (e.g., multiple VectorSearch calls), this serializes what could be parallel I/O operations, significantly impacting performance.

## Findings

**Location:** `src/dsl.ts` (lines 503-511)

**Evidence:**
```typescript
async function normalizeChildren(
  children: readonly BuilderChild[]
): Promise<PromptChildren> {
  const result: PromptChildren = [];
  for (const child of children) {
    result.push(...(await normalizeChild(child)));  // Sequential await
  }
  return result;
}
```

**Performance Impact:**
| Async Children | Sequential Time | Parallel Time | Wasted Time |
|----------------|-----------------|---------------|-------------|
| 3              | 300ms           | 100ms         | 200ms       |
| 5              | 500ms           | 100ms         | 400ms       |
| 10             | 1,000ms         | 100ms         | 900ms       |

The same issue exists in the JSX runtime (`src/jsx/jsx-runtime.ts`, lines 49-55).

## Proposed Solutions

### Option A: Promise.all Parallelization (Recommended)
- Use `Promise.all()` to resolve all children in parallel
- Flatten results maintaining original order
```typescript
async function normalizeChildren(
  children: readonly BuilderChild[]
): Promise<PromptChildren> {
  const resolved = await Promise.all(children.map(normalizeChild));
  return resolved.flat();
}
```
- **Pros:** 5-10x improvement for prompts with multiple async components
- **Cons:** Could cause thundering herd on external services
- **Effort:** Small
- **Risk:** Low (maintains ordering via Promise.all index preservation)

### Option B: Configurable Concurrency
- Add a concurrency option to control parallel resolution
- **Pros:** Prevents thundering herd while allowing parallelism
- **Cons:** More complex API
- **Effort:** Medium
- **Risk:** Low

### Option C: Keep Sequential (Document)
- Keep current behavior, document it's intentional
- **Pros:** Simple, predictable
- **Cons:** Performance penalty for multi-async prompts
- **Effort:** Trivial
- **Risk:** None

## Recommended Action

Option A - Simple Promise.all parallelization. Most use cases will benefit without thundering herd concerns.

## Technical Details

**Affected files:**
- `src/dsl.ts` - `normalizeChildren` function
- `src/jsx/jsx-runtime.ts` - `normalizeChildren` function (same pattern)

## Acceptance Criteria

- [ ] `normalizeChildren` uses Promise.all for parallel resolution
- [ ] Original child ordering is preserved
- [ ] All DSL tests pass
- [ ] JSX runtime updated for parity

## Work Log

| Date | Action | Outcome |
|------|--------|---------|
| 2026-01-11 | Created finding from performance review | Finding documented |

## Resources

- PR: feat/decouple-jsx branch
