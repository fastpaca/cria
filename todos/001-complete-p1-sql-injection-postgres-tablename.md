---
status: complete
priority: p1
issue_id: "001"
tags: [code-review, security, postgres]
dependencies: []
---

# SQL Injection Vulnerability in PostgresStore Table Name

## Problem Statement

The `tableName` configuration option in PostgresStore is interpolated directly into SQL queries without sanitization or parameterization. This creates a SQL injection vulnerability if `tableName` is derived from untrusted input.

## Findings

**Location:** `src/memory/postgres.ts` (lines 88-96, 105-106, 134-142, 155-157)

**Evidence:**
```typescript
// ensureTable()
await this.pool.query(`
  CREATE TABLE IF NOT EXISTS ${this.tableName} (
    ...
  )
`);

// get()
const result = await this.pool.query<KVRow>(
  `SELECT key, data, created_at, updated_at, metadata FROM ${this.tableName} WHERE key = $1`,
  [key]
);
```

**Impact:** An attacker who can control the `tableName` configuration could execute arbitrary SQL commands. Example malicious input:
```typescript
new PostgresStore({ tableName: "users; DROP TABLE users; --" })
```

**Exploitability:** Low in typical usage (configuration set by developers), but Medium if tableName is derived from user input or environment variables.

## Resolution

- Added strict identifier validation to `PostgresStore` with support for optional schema-qualified table names (`schema.table`). Names must match `[A-Za-z_][A-Za-z0-9_]*`.
- Sanitized identifiers are quoted before use in all queries to prevent injection.
- Added unit tests to reject unsafe names and allow safe schema-qualified names.

## Proposed Solutions

### Option A: Regex Validation (Recommended)
- Validate `tableName` against a strict regex (alphanumeric and underscores only)
- Throw an error during construction if invalid
- **Pros:** Simple, low impact on API
- **Cons:** May reject valid PostgreSQL identifiers
- **Effort:** Small
- **Risk:** Low

### Option B: Use pg-format Library
- Use `pg-format` for proper SQL identifier escaping
- **Pros:** Handles all valid PostgreSQL identifiers
- **Cons:** Adds a dependency
- **Effort:** Small
- **Risk:** Low

### Option C: Document as Trusted Input
- Document that `tableName` MUST be a trusted constant
- Add warning in JSDoc
- **Pros:** No code change
- **Cons:** Does not eliminate the vulnerability
- **Effort:** Trivial
- **Risk:** Medium (users may ignore)

## Recommended Action

Option A (Regex Validation) - Add validation in constructor:
```typescript
private static TABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

constructor(options: PostgresStoreOptions) {
  if (!PostgresStore.TABLE_NAME_PATTERN.test(options.tableName)) {
    throw new Error(`Invalid table name: ${options.tableName}. Must contain only alphanumeric characters and underscores.`);
  }
  // ...
}
```

## Technical Details

**Affected files:**
- `src/memory/postgres.ts`

**Components affected:**
- PostgresStore class

## Acceptance Criteria

- [ ] Table name is validated on PostgresStore construction
- [ ] Invalid table names throw a descriptive error
- [ ] All existing tests pass
- [ ] Documentation notes the constraint

## Work Log

| Date | Action | Outcome |
|------|--------|---------|
| 2026-01-11 | Created finding from security review | Finding documented |

## Resources

- PR: feat/decouple-jsx branch
- OWASP SQL Injection: https://owasp.org/www-community/attacks/SQL_Injection
