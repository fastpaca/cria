/**
 * DevTools Smoke - send a single render trace to the DevTools server.
 */

import { createOtelRenderHooks, cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";
import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import OpenAI from "openai";

const tracerProvider = new BasicTracerProvider({
  resource: resourceFromAttributes({
    "service.name": "cria-examples",
    "service.instance.id": "devtools-smoke",
  }),
  spanProcessors: [
    new SimpleSpanProcessor(
      new OTLPTraceExporter({ url: "http://127.0.0.1:4318/v1/traces" })
    ),
  ],
});
trace.setGlobalTracerProvider(tracerProvider);

const tracer = trace.getTracer("cria-examples");
const hooks = createOtelRenderHooks({
  tracer,
  attributes: {
    "cria.prompt.name": "devtools-smoke",
  },
});

const provider = createProvider(new OpenAI({ apiKey: "test" }), "gpt-4o-mini");

try {
  const { messages } = await cria
    .prompt(provider)
    .system("You are helpful.")
    .user("Send a DevTools trace.")
    .assistant("Trace sent.")
    .render({ budget: 800, hooks });

  console.log(`Rendered ${messages.length} messages.`);
  console.log("Trace sent to DevTools.");
} finally {
  await tracerProvider.shutdown();
}
