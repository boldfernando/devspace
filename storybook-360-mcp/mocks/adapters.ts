import { http, HttpResponse } from "msw";
import { fixtureById } from "../fixtures/tool-results.js";
import type { MockModelAdapter, MockRequest, MockScenario } from "./types.js";

export interface MockLanguageModelAdapter {
  generateText(request: MockRequest): Promise<{ text: string; toolCalls: readonly unknown[] }>;
  streamText(request: MockRequest): AsyncIterable<{ type: "text" | "tool-call"; value: unknown }>;
}

export function createMockLanguageModel(
  model: MockModelAdapter,
): MockLanguageModelAdapter {
  return {
    async generateText(request) {
      const events = [] as Array<{ type: "text" | "tool-call"; value: unknown }>;
      for await (const event of model.run(request)) {
        if (event.type === "message") events.push({ type: "text", value: event.response });
        if (event.type === "tool-call") events.push({ type: "tool-call", value: event.call });
      }
      return {
        text: events
          .filter((event) => event.type === "text")
          .map((event) => JSON.stringify(event.value))
          .join("\n"),
        toolCalls: events.filter((event) => event.type === "tool-call").map((event) => event.value),
      };
    },
    async *streamText(request) {
      for await (const event of model.run(request)) {
        if (event.type === "stream-chunk" && event.chunk.kind === "text") {
          yield { type: "text", value: event.chunk.value };
        }
        if (event.type === "tool-call") yield { type: "tool-call", value: event.call };
      }
    },
  };
}

export const storybookMockHandlers = [
  http.get("*/__storybook_360_mcp__/scenario/:scenarioId", ({ params }) => {
    const scenarioId = String(params.scenarioId);
    const fixture = fixtureById.get(scenarioId);
    if (!fixture) return HttpResponse.json({ error: "scenario_not_found" }, { status: 404 });
    return HttpResponse.json({ scenario: fixture.mock, card: fixture.card });
  }),
];

export function scenarioFor(id: string): MockScenario | undefined {
  return fixtureById.get(id)?.mock;
}
