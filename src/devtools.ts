import type { RenderHooks } from "./render";

const DEFAULT_ENDPOINT = "http://127.0.0.1:4318/v1/traces";

export interface DevtoolsOptions {
  serviceName?: string;
  serviceInstanceId?: string;
  endpoint?: string;
  attributes?: Record<string, string | number | boolean>;
}

interface DevtoolsState {
  hooks: RenderHooks;
  shutdown: () => Promise<void>;
}

let globalDevtools: DevtoolsState | null = null;

/**
 * Enable devtools tracing globally.
 *
 * @example
 * ```ts
 * import { cria } from "@fastpaca/cria";
 *
 * cria.devtools(); // enable with defaults
 *
 * // All renders are now traced
 * await cria.prompt(provider).system("Hello").render({ budget: 500 });
 * ```
 */
export function enableDevtools(options?: DevtoolsOptions): void {
  if (globalDevtools) {
    return;
  }

  const serviceName = options?.serviceName ?? "cria-app";
  const instanceId =
    options?.serviceInstanceId ?? `${serviceName}-${Date.now()}`;
  const endpoint = options?.endpoint ?? DEFAULT_ENDPOINT;

  // Dynamic import to avoid bundling OTEL when devtools not used
  const { trace } = requireOtel("@opentelemetry/api");
  const { BasicTracerProvider, SimpleSpanProcessor } = requireOtel(
    "@opentelemetry/sdk-trace-base"
  );
  const { OTLPTraceExporter } = requireOtel(
    "@opentelemetry/exporter-trace-otlp-http"
  );
  const { resourceFromAttributes } = requireOtel("@opentelemetry/resources");
  const { createOtelRenderHooks } = require("./instrumentation/otel") as {
    createOtelRenderHooks: typeof import("./instrumentation/otel").createOtelRenderHooks;
  };

  const tracerProvider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      "service.name": serviceName,
      "service.instance.id": instanceId,
    }),
    spanProcessors: [
      new SimpleSpanProcessor(new OTLPTraceExporter({ url: endpoint })),
    ],
  });

  trace.setGlobalTracerProvider(tracerProvider);
  const tracer = trace.getTracer(serviceName);

  const hooks = createOtelRenderHooks({
    tracer,
    attributes: options?.attributes,
  });

  globalDevtools = {
    hooks,
    shutdown: async () => {
      await tracerProvider.shutdown();
      globalDevtools = null;
    },
  };
}

/**
 * Shutdown devtools and flush pending traces.
 */
export async function shutdownDevtools(): Promise<void> {
  if (!globalDevtools) {
    return;
  }
  await globalDevtools.shutdown();
}

/**
 * Get the global devtools hooks if enabled.
 * Used internally by render() to auto-inject hooks.
 */
export function getGlobalDevtoolsHooks(): RenderHooks | undefined {
  return globalDevtools?.hooks;
}

function requireOtel<T>(moduleName: string): T {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(moduleName) as T;
  } catch {
    throw new Error(
      "cria.devtools() requires OpenTelemetry packages. Install them with:\n\n" +
        "  npm install @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources\n"
    );
  }
}

// Callable interface for cria.devtools()
export interface DevtoolsControl {
  (options?: DevtoolsOptions): void;
  shutdown: () => Promise<void>;
}

export const devtools: DevtoolsControl = Object.assign(enableDevtools, {
  shutdown: shutdownDevtools,
});
