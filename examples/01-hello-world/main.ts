/**
 * Hello World - minimal cria example
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
    "service.instance.id": "hello-world",
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
    "cria.prompt.name": "hello-world",
  },
});

const client = new OpenAI();
const provider = createProvider(client, "gpt-4o-mini");

try {
  const { messages } = await cria
    .prompt(provider)
    .system("You are helpful.")
    .user("What is 2+2?")
    .render({ budget: 500, hooks });

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
  });

  console.log(response.choices[0]?.message?.content);
} finally {
  await tracerProvider.shutdown();
}
