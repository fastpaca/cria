---
status: complete
priority: p1
issue_id: "002"
tags: [code-review, test, quality]
dependencies: []
---

# Malformed Test Structure in dsl.test.ts

## Problem Statement

The test file `src/dsl.test.ts` has a structural error where a test is incorrectly placed outside its describe block due to an extra closing brace. This affects test organization and could lead to test isolation issues.

## Findings

**Location:** `src/dsl.test.ts` (lines 316-337)

**Evidence:**
```typescript
    test("truncate accepts PromptBuilder content", async () => {
      const innerBuilder = cria.prompt().user("builder content");
      const element = await cria
        .prompt()
        .truncate(innerBuilder, { budget: 100 })
        .build();

      const result = await render(element, { tokenizer, budget: 200 });
      expect(result).toContain("builder content");
      });  // <-- Extra closing brace here
    });   // <-- This closes "content types" describe block incorrectly

    test("region() alias works", async () => {  // <-- This test is outside describe blocks
```

**Impact:** The `region() alias works` test runs outside the "content types" describe block. While the test still executes, the organization is incorrect and the test isolation may be compromised.

## Proposed Solutions

### Option A: Remove Extra Brace (Recommended)
- Remove the extraneous `});` on line 325
- Verify test organization is correct
- **Pros:** Simple fix
- **Cons:** None
- **Effort:** Trivial
- **Risk:** None

## Recommended Action

Fix the test structure by removing the extra closing brace.

## Technical Details

**Affected files:**
- `src/dsl.test.ts`

## Acceptance Criteria

- [ ] Extra closing brace removed
- [ ] `region() alias works` test is inside appropriate describe block
- [ ] All tests pass
- [ ] Test organization verified with `vitest --reporter=verbose`

## Work Log

| Date | Action | Outcome |
|------|--------|---------|
| 2026-01-11 | Created finding from TypeScript review | Finding documented |

## Resources

- PR: feat/decouple-jsx branch
