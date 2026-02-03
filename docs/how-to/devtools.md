# DevTools (local prompt inspector)

Cria DevTools is a local inspector that shows the exact prompt payload before/after fit, tool calls/results, and compaction output.

## Run DevTools

From the repo:

```bash
pnpm exec -- cria-devtools
```

Options:

```bash
pnpm exec -- cria-devtools --host 127.0.0.1 --port 4318 --no-open
pnpm exec -- cria-devtools --data-dir .cria-devtools --retention-days 7 --retention-count 500
pnpm exec -- cria-devtools --no-persist
```

## Send traces

Use the OpenTelemetry render hooks to emit traces to the DevTools server.

```ts
import { createOtelRenderHooks, cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";
import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import OpenAI from "openai";

const tracerProvider = new BasicTracerProvider({
  resource: resourceFromAttributes({
    "service.name": "my-app",
    "service.instance.id": "local",
  }),
  spanProcessors: [
    new SimpleSpanProcessor(
      new OTLPTraceExporter({ url: "http://127.0.0.1:4318/v1/traces" })
    ),
  ],
});
trace.setGlobalTracerProvider(tracerProvider);

const tracer = trace.getTracer("my-app");
const hooks = createOtelRenderHooks({
  tracer,
  attributes: {
    "cria.prompt.name": "devtools-smoke",
  },
});

const provider = createProvider(new OpenAI({ apiKey: "test" }), "gpt-4o-mini");
await cria
  .prompt(provider)
  .system("You are helpful.")
  .user("Send a trace.")
  .render({ budget: 800, hooks });

await tracerProvider.shutdown();
```

## Smoke test example

Run the local example that emits a single render trace:

```bash
pnpm --filter devtools-smoke start
```

## Export and import

- Use the "Export payload" or "Export session" buttons in the session header.
- Use "Import" in the toolbar to load a saved session JSON.

## Persistence and retention

DevTools persists sessions to disk by default. You can configure the storage path and retention:

- `--data-dir` sets the storage location (default: `.cria-devtools` in the current working directory).
- `--retention-days` removes sessions older than N days.
- `--retention-count` keeps only the most recent N sessions.
- `--no-persist` disables writing sessions to disk.

## Troubleshooting

- If you see “No sessions yet,” confirm your OTLP exporter URL matches the DevTools endpoint.
- If the stream shows Offline, restart DevTools or refresh the page.
