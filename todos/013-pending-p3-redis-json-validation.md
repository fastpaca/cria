---
status: pending
priority: p3
issue_id: "013"
tags: [code-review, security, validation]
dependencies: []
---

# Redis Data Lacks Runtime Schema Validation

## Problem Statement

Data retrieved from Redis is parsed with `JSON.parse()` and type-asserted without runtime validation. If Redis stores corrupted data or is compromised, the application may behave unexpectedly.

## Findings

**Location:** `src/memory/redis.ts` (lines 89-103)

**Evidence:**
```typescript
async get(key: string): Promise<MemoryEntry<T> | null> {
  const raw = await this.client.get(this.prefixedKey(key));

  if (raw === null) {
    return null;
  }

  // JSON.parse with type assertion, no runtime validation
  const stored = JSON.parse(raw) as StoredEntry<T>;

  return {
    data: stored.data,  // Could be any shape, not validated
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    // ...
  };
}
```

**Impact:** Type assertions provide no runtime safety. If stored data doesn't match expected shape, subtle bugs may occur.

## Proposed Solutions

### Option A: Zod Schema Validation (Recommended)
- Use Zod schemas (already in codebase) to validate retrieved data
- Throw clear error if validation fails
```typescript
const StoredEntrySchema = z.object({
  data: z.unknown(),
  createdAt: z.string(),
  updatedAt: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

const stored = StoredEntrySchema.parse(JSON.parse(raw));
```
- **Pros:** Strong runtime guarantees, uses existing tooling
- **Cons:** Small performance overhead
- **Effort:** Small
- **Risk:** Low

### Option B: Basic Shape Validation
- Check for required properties without full schema
- **Pros:** Lightweight
- **Cons:** Less comprehensive
- **Effort:** Small
- **Risk:** Low

### Option C: Document and Accept
- Document that Redis data is trusted
- **Pros:** No code change
- **Cons:** Doesn't address the issue
- **Effort:** None
- **Risk:** Medium

## Recommended Action

Option A - Use Zod validation for consistency with rest of codebase.

## Technical Details

**Affected files:**
- `src/memory/redis.ts`

## Acceptance Criteria

- [ ] Retrieved data validated against Zod schema
- [ ] Clear error thrown if validation fails
- [ ] All tests pass
- [ ] Similar pattern applied to other memory stores

## Work Log

| Date | Action | Outcome |
|------|--------|---------|
| 2026-01-11 | Created finding from security review | Finding documented |

## Resources

- PR: feat/decouple-jsx branch
