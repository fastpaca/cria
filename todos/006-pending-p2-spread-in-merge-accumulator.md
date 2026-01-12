---
status: pending
priority: p2
issue_id: "006"
tags: [code-review, performance]
dependencies: []
---

# Spread Operator in Accumulator Creates O(k^2) Complexity in merge()

## Problem Statement

The `merge()` method uses spread operators in an accumulator loop, creating O(k^2 * n) time complexity when merging k builders with n children each. This is a known anti-pattern that can significantly impact performance.

## Findings

**Location:** `src/dsl.ts` (lines 249-263)

**Evidence:**
```typescript
merge(...builders: PromptBuilder[]): PromptBuilder {
  let nextContext = this.context;
  const mergedChildren: BuilderChild[] = [...this.children];  // Initial copy: O(n)

  for (const b of builders) {
    // ...
    mergedChildren.push(...b.children);  // Spread in accumulator! Each iteration copies
  }

  return new PromptBuilder(mergedChildren, nextContext);
}
```

**Complexity Analysis:**
- Initial spread: O(n)
- Loop spreads: O(n) + O(2n) + O(3n) + ... = O(k^2 * n)

For merging 10 builders with 100 children each:
- Current: ~550,000 element copies
- Optimal: ~1,000 element copies

## Proposed Solutions

### Option A: Pre-allocate and Copy (Recommended)
```typescript
merge(...builders: PromptBuilder[]): PromptBuilder {
  let totalSize = this.children.length;
  for (const b of builders) totalSize += b.children.length;

  const mergedChildren: BuilderChild[] = new Array(totalSize);
  let idx = 0;

  for (const child of this.children) mergedChildren[idx++] = child;
  for (const b of builders) {
    for (const child of b.children) mergedChildren[idx++] = child;
  }

  return new PromptBuilder(mergedChildren, nextContext);
}
```
- **Pros:** O(n) complexity, optimal performance
- **Cons:** More verbose code
- **Effort:** Small
- **Risk:** Low

### Option B: Use Array.prototype.concat
```typescript
const mergedChildren = [this.children, ...builders.map(b => b.children)].flat();
```
- **Pros:** Concise
- **Cons:** Still creates intermediate arrays
- **Effort:** Trivial
- **Risk:** Low

## Recommended Action

Option A - Pre-allocate and copy for optimal performance.

## Technical Details

**Affected files:**
- `src/dsl.ts` - merge() method

**Also consider:**
- `cria.merge()` static helper uses reduce, compounding the issue

## Acceptance Criteria

- [ ] merge() uses O(n) algorithm instead of O(k^2 * n)
- [ ] All tests pass
- [ ] Benchmark shows improvement for large merges

## Work Log

| Date | Action | Outcome |
|------|--------|---------|
| 2026-01-11 | Created finding from performance review | Finding documented |

## Resources

- PR: feat/decouple-jsx branch
- Biome lint rule: noAccumulatingSpread
