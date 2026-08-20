import type { ToolResultCard } from "../../src/ui/card-types.js";
import type { MockScenario } from "../mocks/types.js";

export interface ToolStoryFixture {
  id: string;
  label: string;
  card: ToolResultCard;
  mock: MockScenario;
}

const textPayload = (text: string) => ({
  content: [{ type: "text" as const, text }],
});

export const toolStoryFixtures: readonly ToolStoryFixture[] = [
  {
    id: "read-success",
    label: "Read · success",
    card: {
      tool: "read",
      path: "src/ui/workspace-app.tsx",
      status: "completed",
      summary: { bytes: 2560, lines: 48 },
      payload: textPayload("export function renderWorkspace() {\n  return \"deterministic\";\n}"),
    },
    mock: {
      id: "read-success",
      state: "success",
      latencyMs: 0,
      response: { status: "completed" },
      stream: [{ kind: "text", value: "read complete" }],
    },
  },
  {
    id: "write-error",
    label: "Write · error",
    card: {
      tool: "write",
      path: "src/ui/missing.tsx",
      status: "failed",
      payload: textPayload("Unable to write the file."),
    },
    mock: {
      id: "write-error",
      state: "error",
      latencyMs: 0,
      error: { code: "WRITE_FAILED", message: "Deterministic write failure." },
    },
  },
  {
    id: "glob-empty",
    label: "Glob · empty",
    card: {
      tool: "glob",
      path: "src/**/*.stories.tsx",
      status: "completed",
      summary: { matches: 0 },
      payload: textPayload("No matching story files."),
    },
    mock: {
      id: "glob-empty",
      state: "empty",
      latencyMs: 0,
      response: { matches: [] },
    },
  },
  {
    id: "workspace-loading",
    label: "Workspace · loading",
    card: {
      tool: "open_workspace",
      root: "C:/workspace/devspace",
      status: "loading",
      summary: { agentsFiles: 0, skills: 0 },
    },
    mock: {
      id: "workspace-loading",
      state: "loading",
      latencyMs: 0,
    },
  },
  {
    id: "bash-timeout",
    label: "Bash · timeout",
    card: {
      tool: "bash",
      status: "timeout",
      payload: textPayload("Command timed out safely."),
    },
    mock: {
      id: "bash-timeout",
      state: "timeout",
      latencyMs: 1,
      error: { code: "TIMEOUT", message: "Deterministic timeout." },
    },
  },
  {
    id: "exec-retry-tool-call",
    label: "Exec · retry + tool call",
    card: {
      tool: "exec_command",
      status: "retry",
      summary: { attempts: 1 },
      payload: textPayload("Retry is available."),
    },
    mock: {
      id: "exec-retry-tool-call",
      state: "retry",
      latencyMs: 0,
      error: { code: "RETRYABLE", message: "Retryable command failure." },
      toolCalls: [{ name: "exec_command", input: { command: "echo fixture" } }],
      stream: [
        { kind: "tool-call", name: "exec_command", input: { command: "echo fixture" } },
        { kind: "tool-result", name: "exec_command", output: { exitCode: 0 } },
      ],
    },
  },
  {
    id: "streaming-read",
    label: "Read · streaming",
    card: {
      tool: "read",
      path: "src/ui/stream.tsx",
      status: "streaming",
      payload: textPayload("chunk one\nchunk two"),
    },
    mock: {
      id: "streaming-read",
      state: "success",
      latencyMs: 0,
      response: { status: "completed" },
      stream: [
        { kind: "text", value: "chunk one" },
        { kind: "text", value: "chunk two" },
        { kind: "tool-call", name: "read", input: { path: "src/ui/stream.tsx" } },
        { kind: "tool-result", name: "read", output: { lines: 2 } },
      ],
      toolCalls: [{ name: "read", input: { path: "src/ui/stream.tsx" }, output: { lines: 2 } }],
    },
  },
];

export const fixtureById = new Map(toolStoryFixtures.map((fixture) => [fixture.id, fixture]));
