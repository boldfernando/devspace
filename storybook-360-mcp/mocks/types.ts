export type MockState = "success" | "error" | "empty" | "loading" | "timeout" | "retry";

export type MockStreamChunk =
  | { kind: "text"; value: string }
  | { kind: "tool-call"; name: string; input: Record<string, unknown> }
  | { kind: "tool-result"; name: string; output: Record<string, unknown> };

export interface MockToolCall {
  name: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
}

export interface MockScenario<TResponse = unknown> {
  id: string;
  state: MockState;
  latencyMs: number;
  response?: TResponse;
  error?: { code: string; message: string };
  stream?: MockStreamChunk[];
  toolCalls?: MockToolCall[];
  retryAfterMs?: number;
}

export interface MockRequest {
  scenarioId: string;
  prompt?: string;
  toolName?: string;
}

export type MockEvent<TResponse = unknown> =
  | { type: "loading"; scenarioId: string }
  | { type: "message"; scenarioId: string; response: TResponse }
  | { type: "tool-call"; scenarioId: string; call: MockToolCall }
  | { type: "stream-chunk"; scenarioId: string; chunk: MockStreamChunk }
  | { type: "error"; scenarioId: string; error: { code: string; message: string } }
  | { type: "done"; scenarioId: string };

export interface MockModelAdapter {
  run<TResponse>(request: MockRequest): AsyncIterable<MockEvent<TResponse>>;
}

export interface MockNetworkAdapter {
  install(): void;
  reset(): void;
}
