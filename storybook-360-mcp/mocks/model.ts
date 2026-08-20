import type {
  MockEvent,
  MockModelAdapter,
  MockRequest,
  MockScenario,
} from "./types.js";

const DEFAULT_ERROR = { code: "MOCK_ERROR", message: "Deterministic mock failure." };

function wait(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

export class DeterministicMockModel implements MockModelAdapter {
  readonly #scenarios: ReadonlyMap<string, MockScenario>;

  constructor(scenarios: readonly MockScenario[]) {
    this.#scenarios = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  }

  async *run<TResponse>(request: MockRequest): AsyncIterable<MockEvent<TResponse>> {
    const scenario = this.#scenarios.get(request.scenarioId);
    if (!scenario) {
      yield {
        type: "error",
        scenarioId: request.scenarioId,
        error: { code: "MOCK_SCENARIO_NOT_FOUND", message: "Mock scenario not found." },
      };
      return;
    }

    yield { type: "loading", scenarioId: scenario.id };
    if (scenario.state === "loading") return;

    if (scenario.state === "timeout") {
      await wait(Math.max(scenario.latencyMs, 1));
      yield {
        type: "error",
        scenarioId: scenario.id,
        error: { code: "MOCK_TIMEOUT", message: "Deterministic mock timeout." },
      };
      return;
    }

    await wait(scenario.latencyMs);

    if (scenario.state === "error") {
      yield { type: "error", scenarioId: scenario.id, error: scenario.error ?? DEFAULT_ERROR };
      return;
    }

    if (scenario.state === "retry") {
      yield {
        type: "error",
        scenarioId: scenario.id,
        error: scenario.error ?? { code: "MOCK_RETRYABLE", message: "Retryable mock failure." },
      };
      return;
    }

    for (const call of scenario.toolCalls ?? []) {
      yield { type: "tool-call", scenarioId: scenario.id, call };
    }

    for (const chunk of scenario.stream ?? []) {
      await wait(0);
      yield { type: "stream-chunk", scenarioId: scenario.id, chunk };
    }

    if (scenario.state !== "empty" && scenario.response !== undefined) {
      yield {
        type: "message",
        scenarioId: scenario.id,
        response: scenario.response as TResponse,
      };
    }

    yield { type: "done", scenarioId: scenario.id };
  }
}

export function createDeterministicMockModel(
  scenarios: readonly MockScenario[],
): MockModelAdapter {
  return new DeterministicMockModel(scenarios);
}
