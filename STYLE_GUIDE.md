# TypeScript Style Guide

This guide defines how we write TypeScript. It optimizes for **correctness**, **clarity**, and **maintainability**. The linter (Ultracite/Biome) enforces most rules automatically—run `npm exec -- ultracite fix` before committing.

---

## Philosophy

1. **Validate at the edges, trust internally** — Use runtime validation (Zod, etc.) at trust boundaries (API responses, user input, env vars). Once validated, trust the refined types throughout the codebase. No defensive re-checking.

2. **Explicit over implicit** — Make types, intentions, and control flow obvious. Avoid magic.

3. **Immutable by default** — Use `const`, `readonly`, and return new values instead of mutating.

4. **Simple over clever** — Write code a newcomer can understand. Avoid premature abstraction.

5. **Let the type system work** — Design types that make invalid states unrepresentable. Use discriminated unions and exhaustive checks.

---

## Type System

### Use `unknown`, Never `any`

```typescript
// Bad
function parse(data: any) { ... }

// Good
function parse(data: unknown) {
  if (!isValidData(data)) throw new Error('Invalid data');
  // data is now narrowed
}
```

### Discriminated Unions with Exhaustive Checks

Model state explicitly. Use a discriminant property and handle all cases.

```typescript
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function handle(result: Result<User, string>) {
  switch (result.ok) {
    case true:
      return result.value;
    case false:
      throw new Error(result.error);
    default:
      // Compile error if a case is missing
      const _exhaustive: never = result;
      throw new Error('Unhandled case');
  }
}
```

### Use `satisfies` for Validated Inference

Use `satisfies` when you want type validation without widening the inferred type.

```typescript
// Bad — loses literal types
const routes: Record<string, Route> = {
  '/home': { path: '/home' },
};

// Good — validates shape, keeps literals
const routes = {
  '/home': { path: '/home' },
} satisfies Record<string, Route>;
```

Combine with `as const` for maximum precision:

```typescript
const config = {
  timeout: 5000,
  retries: 3,
} as const satisfies Config;
```

### Prefer `interface` for Object Types

```typescript
// Preferred
interface User {
  id: string;
  name: string;
}

// Use type for unions, intersections, mapped types
type Status = 'pending' | 'active' | 'inactive';
```

### Derive Types from Source of Truth

Don't copy-paste type definitions. Derive them.

```typescript
// From values
const STATUSES = ['pending', 'active', 'inactive'] as const;
type Status = (typeof STATUSES)[number];

// From objects
const config = { timeout: 5000 } as const;
type Config = typeof config;

// From functions
type ParseResult = ReturnType<typeof parse>;

// From parameters
type Options = Parameters<typeof createClient>[0];
```

### Branded Types for Semantic Primitives

Distinguish structurally identical but semantically different values.

```typescript
type UserId = string & { readonly __brand: 'UserId' };
type PostId = string & { readonly __brand: 'PostId' };

function createUserId(id: string): UserId {
  return id as UserId;
}

function getUser(id: UserId) { ... }

// Compile error — can't pass PostId to UserId parameter
getUser(postId);
```

### No Type Assertions or Non-Null Assertions

Avoid `as` and `!`. Fix the types or add runtime checks.

```typescript
// Bad
const user = data as User;
const name = user!.name;

// Good
if (!isUser(data)) throw new Error('Invalid user');
const name = user.name;
```

---

## No Enums

Enums are banned. Use `as const` objects with derived union types.

```typescript
// Bad
enum Status {
  Pending = 'pending',
  Active = 'active',
}

// Good
const Status = {
  Pending: 'pending',
  Active: 'active',
} as const;

type Status = (typeof Status)[keyof typeof Status];
```

This gives you:
- Autocomplete: `Status.Pending`
- Type safety: `Status` union type
- No runtime overhead beyond the object

---

## Immutability

### Default to `const` and `readonly`

```typescript
// Variables
const count = 0;
let mutable = 0; // Only when reassignment is required

// Arrays and objects
const items: readonly string[] = ['a', 'b'];
const config: Readonly<Config> = { ... };

// Class properties (enforced by linter)
class Service {
  readonly client: Client;
}
```

### Never Mutate Parameters

```typescript
// Bad
function process(items: Item[]) {
  items.push(newItem); // Mutates input
}

// Good
function process(items: readonly Item[]): Item[] {
  return [...items, newItem];
}
```

### Avoid Spread in Loops

Spreads in accumulators cause O(n²) performance.

```typescript
// Bad
const result = items.reduce((acc, item) => [...acc, transform(item)], []);

// Good
const result = items.map(transform);

// Or preallocate
const result: Item[] = [];
for (const item of items) {
  result.push(transform(item));
}
```

---

## Code Organization

### YAGNI — You Aren't Gonna Need It

- Start with concrete implementations
- Extract abstractions only when patterns emerge (3+ usages)
- Don't design for hypothetical future requirements
- Delete unused code; don't comment it out

### Early Returns

Reduce nesting with guard clauses.

```typescript
// Bad
function process(user: User | null) {
  if (user) {
    if (user.isActive) {
      return doWork(user);
    }
  }
  return null;
}

// Good
function process(user: User | null) {
  if (!user) return null;
  if (!user.isActive) return null;
  return doWork(user);
}
```

### Keep Functions Focused

- One purpose per function
- Limit cognitive complexity (the linter enforces this)
- Extract complex conditions into named booleans

```typescript
// Bad
if (user.role === 'admin' && user.isActive && !user.isSuspended) { ... }

// Good
const canPerformAction = user.role === 'admin' && user.isActive && !user.isSuspended;
if (canPerformAction) { ... }
```

---

## Error Handling

### Throw Only Error Objects

```typescript
// Bad
throw 'Something went wrong';
throw { message: 'error' };

// Good
throw new Error('Something went wrong');
throw new ValidationError('Invalid input', { field: 'email' });
```

### Validate at Boundaries

Use Zod or similar for external data.

```typescript
import { z } from 'zod';

const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
});

type User = z.infer<typeof UserSchema>;

async function fetchUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  const data = await response.json();
  return UserSchema.parse(data); // Throws if invalid
}
```

### Consider Result Types

For error-prone operations, make failure explicit in the return type.

```typescript
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function parseConfig(raw: string): Result<Config> {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}
```

---

## Imports and Exports

### Named Exports Only

```typescript
// Bad
export default function process() { ... }

// Good
export function process() { ... }
```

### Type-Only Imports

Use `import type` for types that don't need runtime presence.

```typescript
import type { User } from './types';
import { validateUser } from './validation';
```

### No Barrel Files

Don't create index files that re-export everything. Import from the source.

```typescript
// Bad — barrel file
export * from './user';
export * from './post';

// Good — import directly
import { User } from './user';
import { Post } from './post';
```

### No Namespace Imports

```typescript
// Bad
import * as utils from './utils';

// Good
import { formatDate, parseDate } from './utils';
```

---

## Functions

### Arrow Functions for Callbacks

```typescript
// Bad
items.map(function (item) {
  return transform(item);
});

// Good
items.map((item) => transform(item));
```

### No `Function` Type

Define specific signatures.

```typescript
// Bad
function execute(callback: Function) { ... }

// Good
function execute(callback: (result: Result) => void) { ... }
```

### Rest Parameters over `arguments`

```typescript
// Bad
function log() {
  console.log(Array.from(arguments));
}

// Good
function log(...args: unknown[]) {
  console.log(args);
}
```

### Default Parameters Last

```typescript
// Bad
function create(options = {}, name: string) { ... }

// Good
function create(name: string, options = {}) { ... }
```

---

## Classes

### Prefer Object Literals for Singletons

```typescript
// Bad — unnecessary class
class Validator {
  validateEmail(email: string) { ... }
}
const validator = new Validator();

// Good
const validator = {
  validateEmail(email: string) { ... },
};
```

### Readonly Properties by Default

The linter enforces this. Mark properties `readonly` unless mutation is required.

```typescript
class Service {
  readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }
}
```

### No Parameter Properties

The linter bans `constructor(private x)`. Declare properties explicitly.

```typescript
// Bad
class Service {
  constructor(private readonly client: Client) {}
}

// Good
class Service {
  readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }
}
```

---

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Files | kebab-case | `user-service.ts` |
| Variables, functions | camelCase | `getUserById` |
| Constants | CONSTANT_CASE | `MAX_RETRIES` |
| Types, interfaces, classes | PascalCase | `UserService` |
| Type parameters | Single uppercase or PascalCase | `T`, `TResult` |
| Private fields | camelCase (no underscore prefix) | `client` |

### Naming Guidelines

- Use descriptive names over abbreviations
- Boolean variables: use `is`, `has`, `should` prefixes
- Functions: use verbs (`get`, `create`, `validate`)
- Avoid Hungarian notation (`strName`, `arrItems`)
- Treat acronyms as words: `userId` not `userID`

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Use `async`/`await`, not done callbacks
- Never commit `.only` or `.skip`
- Keep suites flat — avoid deep `describe` nesting
- Name tests descriptively: `'returns null when user not found'`

---

## Linter Reference

This guide aligns with Ultracite (Biome). Key enforced rules:

| Rule | Enforcement |
|------|-------------|
| `noExplicitAny` | No `any` type |
| `noNonNullAssertion` | No `!` assertions |
| `noForEach` | Use `for...of` |
| `noEnum` | No enums |
| `noVar` | No `var` |
| `useConst` | Prefer `const` |
| `useArrowFunction` | Arrow functions for expressions |
| `useImportType` | Type-only imports |
| `noBarrelFile` | No re-export index files |
| `noNamespaceImport` | No `import *` |
| `useReadonlyClassProperties` | Class props must be `readonly` |
| `noParameterProperties` | No `constructor(private x)` |
| `noAccumulatingSpread` | No spread in loop accumulators |
| `useFilenamingConvention` | kebab-case files |

Run `npm exec -- ultracite fix` to auto-fix most issues.
