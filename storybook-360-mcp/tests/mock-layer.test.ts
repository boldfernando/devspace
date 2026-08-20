import assert from "node:assert/strict";
import test from "node:test";
import { fixtureById, toolStoryFixtures } from "../fixtures/tool-results.js";
import { createMockLanguageModel } from "../mocks/adapters.js";
import { createDeterministicMockModel } from "../mocks/model.js";

const requiredStates = new Set(["success", "error", "empty", "loading", "timeout", "retry"]);

test("fixture catalog covers every required deterministic state", () => {
  const states = new Set(toolStoryFixtures.map((fixture) => fixture.mock.state));
  for (const state of requiredStates) assert.ok(states.has(state), `missing state: ${state}`);
  assert.equal(fixtureById.size, toolStoryFixtures.length);
  for (const fixture of toolStoryFixtures) {
    assert.equal(fixture.card.tool.length > 0, true);
    assert.equal(fixture.mock.id, fixture.id);
    assert.equal(fixture.mock.latencyMs >= 0, true);
  }
});

test("model mock is deterministic and emits tool calls plus streaming chunks", async () => {
  const fixture = fixtureById.get("streaming-read");
  assert.ok(fixture);
  const model = createDeterministicMockModel([fixture.mock]);
  const first = [];
  const second = [];
  for await (const event of model.run({ scenarioId: fixture.id })) first.push(event);
  for await (const event of model.run({ scenarioId: fixture.id })) second.push(event);
  assert.deepEqual(second, first);
  assert.ok(first.some((event) => event.type === "tool-call"));
  assert.ok(first.some((event) => event.type === "stream-chunk"));
  assert.ok(first.some((event) => event.type === "done"));
});

test("AI model adapter uses the injected mock and never requires a provider", async () => {
  const fixture = fixtureById.get("read-success");
  assert.ok(fixture);
  const adapter = createMockLanguageModel(createDeterministicMockModel([fixture.mock]));
  const generated = await adapter.generateText({ scenarioId: fixture.id, prompt: "read" });
  assert.match(generated.text, /completed/);
  const chunks = [];
  for await (const chunk of adapter.streamText({ scenarioId: fixture.id })) chunks.push(chunk);
  assert.ok(chunks.some((chunk) => chunk.type === "text"));
});

test("missing scenarios fail closed without network fallback", async () => {
  const model = createDeterministicMockModel([]);
  const events = [];
  for await (const event of model.run({ scenarioId: "does-not-exist" })) events.push(event);
  assert.deepEqual(events, [{
    type: "error",
    scenarioId: "does-not-exist",
    error: { code: "MOCK_SCENARIO_NOT_FOUND", message: "Mock scenario not found." },
  }]);
});
