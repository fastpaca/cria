/**
 * Rich Example - demonstrates varied message types for devtools testing
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
    "service.instance.id": "rich-example",
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
    "cria.prompt.name": "weather-assistant",
  },
});

const client = new OpenAI();
const provider = createProvider(client, "gpt-4o-mini");

// Define tools for the assistant (for reference - not used in this example)
const _tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather for a location",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "City name" },
          units: { type: "string", enum: ["celsius", "fahrenheit"] },
        },
        required: ["location"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_restaurants",
      description: "Search for restaurants in a location",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string" },
          cuisine: { type: "string" },
          price_range: { type: "string", enum: ["$", "$$", "$$$", "$$$$"] },
        },
        required: ["location"],
      },
    },
  },
];

try {
  // Build a complex conversation with tool calls
  const { messages } = await cria
    .prompt(provider)
    .system(`You are a helpful travel assistant. You can check weather and find restaurants.

When helping users plan their day:
1. Always check the weather first
2. Make personalized recommendations based on conditions
3. Suggest appropriate attire and activities`)
    .user("I'm planning a trip to Paris next week. What's the weather like?")
    .assistant(undefined, {
      toolCalls: [
        {
          id: "call_weather_1",
          type: "function",
          function: {
            name: "get_weather",
            arguments: JSON.stringify({ location: "Paris", units: "celsius" }),
          },
        },
      ],
    })
    .tool({
      type: "tool-result",
      toolCallId: "call_weather_1",
      toolName: "get_weather",
      output: JSON.stringify({
        location: "Paris",
        temperature: 18,
        condition: "Partly cloudy",
        humidity: 65,
        wind_speed: 12,
        forecast: [
          { day: "Mon", high: 20, low: 14, condition: "Sunny" },
          { day: "Tue", high: 19, low: 13, condition: "Cloudy" },
          { day: "Wed", high: 17, low: 12, condition: "Light rain" },
        ],
      }),
    })
    .assistant(`Based on the weather data, Paris will be lovely next week!

**Current Conditions:**
- Temperature: 18°C (64°F)
- Partly cloudy with 65% humidity
- Light winds at 12 km/h

**Weekly Forecast:**
| Day | High | Low | Conditions |
|-----|------|-----|------------|
| Mon | 20°C | 14°C | ☀️ Sunny |
| Tue | 19°C | 13°C | ☁️ Cloudy |
| Wed | 17°C | 12°C | 🌧️ Light rain |

I'd recommend packing layers and bringing a light rain jacket for Wednesday. Would you like restaurant recommendations for your trip?`)
    .user("Yes! I'd love some restaurant suggestions for a romantic dinner.")
    .assistant(undefined, {
      toolCalls: [
        {
          id: "call_restaurants_1",
          type: "function",
          function: {
            name: "search_restaurants",
            arguments: JSON.stringify({
              location: "Paris",
              cuisine: "French",
              price_range: "$$$",
            }),
          },
        },
      ],
    })
    .tool({
      type: "tool-result",
      toolCallId: "call_restaurants_1",
      toolName: "search_restaurants",
      output: JSON.stringify({
        results: [
          {
            name: "Le Comptoir du Panthéon",
            rating: 4.7,
            price: "$$$",
            cuisine: "French Bistro",
            address: "5 Rue Soufflot, 75005 Paris",
            highlights: [
              "Romantic ambiance",
              "Terrace seating",
              "Wine selection",
            ],
          },
          {
            name: "Bouillon Chartier",
            rating: 4.5,
            price: "$$",
            cuisine: "Traditional French",
            address: "7 Rue du Faubourg Montmartre",
            highlights: ["Historic setting", "Classic dishes", "Affordable"],
          },
        ],
      }),
    })
    .assistant(`Here are my top romantic dinner recommendations in Paris:

## 🍷 Le Comptoir du Panthéon
**Rating:** ⭐ 4.7/5 | **Price:** $$$

A beautiful French bistro with:
- Intimate romantic ambiance
- Lovely terrace seating with views
- Excellent wine selection

*Address:* 5 Rue Soufflot, 75005 Paris

## 🥖 Bouillon Chartier
**Rating:** ⭐ 4.5/5 | **Price:** $$

Historic brasserie featuring:
- Belle Époque architecture
- Classic French dishes
- Great value for Paris

*Address:* 7 Rue du Faubourg Montmartre

Would you like me to help with anything else for your trip?`)
    .render({ budget: 2000, hooks });

  console.log("Prompt rendered successfully!");
  console.log(`Message count: ${messages.length}`);
  console.log("\nMessages sent to devtools for inspection.");
} finally {
  await tracerProvider.shutdown();
}
