# Cria OpenTelemetry Observability

## Overview

Add OpenTelemetry instrumentation to Cria so users can trace prompt rendering, see what got cut/truncated, and diff prompt states over time.

**Principle:** Cria emits OTel spans. That's it. No custom abstractions. Visualization tools consume standard OTel traces.

## Goals

1. Zero overhead when OTel is not configured
2. Full IR snapshots (before/after fitting) for diffing
3. Per-node spans with decision metadata (kept/truncated/omitted)
4. Compatible with any OTel backend (Jaeger, Datadog, Langfuse, etc.)

## Non-Goals (For Now)

- Built-in visualization UI (separate tool, future work)
- Custom trace storage format
- Checkpointing/restore (future work, builds on this foundation)

## Design

### Instrumentation Package

```typescript
import { CriaInstrumentation } from '@fastpaca/cria/instrumentation';
```

Standard OTel instrumentation pattern. When registered, automatically instruments `render()` calls.

### Span Hierarchy

Each `render()` call produces a trace. The prompt tree maps directly to span hierarchy:

```
Span: cria.render
│   Attributes:
│     cria.budget: 128000
│     cria.tokens.final: 95000
│     cria.iterations: 3
│     cria.renderer: "openai"
│     cria.ir.before: "{...}"    # Full IR JSON
│     cria.ir.after: "{...}"     # Full IR JSON after fitting
│
├── Span: cria.region
│     cria.id: "system-prompt"   # If user provided id prop
│     cria.priority: 0
│     cria.status: "kept"
│     cria.tokens: 12000
│     cria.content: "You are..."
│
├── Span: cria.message
│     cria.priority: 1
│     cria.status: "kept"
│     cria.kind: "message"
│     cria.role: "user"
│     cria.tokens: 2000
│     cria.content: "Help me..."
│
└── Span: cria.region
      cria.id: "rag-context"
      cria.priority: 2
      cria.status: "truncated"
      cria.tokens.before: 52000
      cria.tokens.after: 38000
      │
      └── Event: cria.strategy.applied
            cria.strategy: "truncate"
            cria.iteration: 2
            cria.tokens.freed: 14000
```

### Span Attributes

#### Root Span (`cria.render`)

| Attribute | Type | Description |
|-----------|------|-------------|
| `cria.budget` | int | Token budget for this render |
| `cria.tokens.final` | int | Final token count after fitting |
| `cria.iterations` | int | Number of fitting iterations |
| `cria.renderer` | string | Renderer name (e.g., "openai", "anthropic") |
| `cria.ir.before` | string | JSON-serialized IR before fitting |
| `cria.ir.after` | string | JSON-serialized IR after fitting |

#### Node Spans (`cria.region`, `cria.message`, etc.)

| Attribute | Type | Description |
|-----------|------|-------------|
| `cria.id` | string? | User-provided id prop (optional) |
| `cria.priority` | int | Priority level (0 = highest importance) |
| `cria.status` | string | `kept` \| `truncated` \| `omitted` |
| `cria.tokens` | int | Token count (final) |
| `cria.tokens.before` | int? | Token count before truncation |
| `cria.tokens.after` | int? | Token count after truncation |
| `cria.kind` | string? | Semantic kind: `message`, `tool-call`, `tool-result`, `reasoning` |
| `cria.role` | string? | Message role (for `kind: message`) |
| `cria.content` | string | Actual content at this node |

#### Events

**`cria.strategy.applied`** - Recorded when a strategy modifies a node

| Attribute | Type | Description |
|-----------|------|-------------|
| `cria.strategy` | string | Strategy type (e.g., "truncate", "omit", custom name) |
| `cria.iteration` | int | Which fitting iteration |
| `cria.tokens.freed` | int | Tokens freed by this action |

### GenAI Semantic Convention Compatibility

We also emit standard GenAI attributes on the root span:

```typescript
'gen_ai.system': 'cria',
'gen_ai.request.model': '...',      // If known from renderer
'gen_ai.usage.prompt_tokens': 95000,
```

### Usage

#### Basic Setup

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { CriaInstrumentation } from '@fastpaca/cria/instrumentation';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces',
  }),
  instrumentations: [new CriaInstrumentation()],
});
sdk.start();

// Now all render() calls emit traces automatically
await render(prompt, { tokenizer, budget: 128000 });
```

#### Console Output (Development)

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { CriaInstrumentation } from '@fastpaca/cria/instrumentation';

const sdk = new NodeSDK({
  traceExporter: new ConsoleSpanExporter(),
  instrumentations: [new CriaInstrumentation()],
});
sdk.start();
```

#### Disable Content Capture (Production)

```typescript
new CriaInstrumentation({
  captureContent: false,  // Don't include cria.content attributes
  captureIR: false,       // Don't include full IR snapshots
})
```

### Implementation

#### Files to Add

```
src/
  instrumentation/
    index.ts              # CriaInstrumentation class
    attributes.ts         # Attribute name constants
    trace-collector.ts    # Collects data during render
```

#### Integration Points

1. **Before `fitToBudget`** - Snapshot IR, start root span
2. **During tree traversal** - Create child spans for each node
3. **On strategy application** - Record event, update node status
4. **After `fitToBudget`** - Snapshot final IR, close spans

#### Zero-Overhead When Disabled

```typescript
// In render.ts
import { context, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('cria');

export async function render(...) {
  const span = tracer.startSpan('cria.render');

  // If no-op tracer (OTel not configured), this is essentially free
  if (!span.isRecording()) {
    return renderWithoutTracing(...);
  }

  return renderWithTracing(span, ...);
}
```

## Future Work

- **Visualization tool** - Separate package to view/diff OTel traces
- **Checkpointing** - Save/restore prompt states using IR snapshots
- **Streaming traces** - For long-running renders

## References

- [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OpenLLMetry](https://github.com/traceloop/openllmetry)
