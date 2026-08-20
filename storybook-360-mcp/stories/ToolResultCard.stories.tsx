import { useEffect, useMemo, useState } from "react";
import type { Meta, StoryObj } from "storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { getToolDisplay } from "../../src/ui/tool-display.js";
import { isExpandableCard, payloadText, type ToolResultCard } from "../../src/ui/card-types.js";
import { fixtureById, toolStoryFixtures, type ToolStoryFixture } from "../fixtures/tool-results.js";
import { createDeterministicMockModel } from "../mocks/model.js";
import type { MockEvent } from "../mocks/types.js";
import { storybookMockHandlers } from "../mocks/adapters.js";

interface ToolResultCardStoryProps {
  fixtureId: string;
  autoStream?: boolean;
}

function statusText(fixture: ToolStoryFixture, attempted: boolean): string {
  if (fixture.mock.state === "loading") return "Loading deterministic fixture…";
  if (fixture.mock.state === "timeout") return "Command timed out safely.";
  if (fixture.mock.state === "error") return fixture.mock.error?.message ?? "Deterministic error.";
  if (fixture.mock.state === "retry" && !attempted) return "Retry is available.";
  if (fixture.mock.state === "empty") return "No details available.";
  return fixture.card.status ?? "Completed";
}

function ToolResultCardStory({ fixtureId, autoStream = false }: ToolResultCardStoryProps) {
  const fixture = fixtureById.get(fixtureId) ?? toolStoryFixtures[0];
  const [expanded, setExpanded] = useState(isExpandableCard(fixture.card));
  const [attempted, setAttempted] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [events, setEvents] = useState<readonly MockEvent[]>([]);
  const display = getToolDisplay(fixture.card);
  const activeCard: ToolResultCard = attempted && fixture.mock.state === "retry"
    ? { ...fixture.card, status: "success", payload: { content: [{ type: "text", text: "Retry succeeded." }] } }
    : fixture.card;
  const model = useMemo(() => createDeterministicMockModel([
    attempted && fixture.mock.state === "retry"
      ? { ...fixture.mock, state: "success", error: undefined, response: { status: "retry_succeeded" } }
      : fixture.mock,
  ]), [attempted, fixture.mock]);

  useEffect(() => {
    if (!autoStream && fixture.mock.stream?.length === 0) return;
    let cancelled = false;
    void (async () => {
      for await (const event of model.run({ scenarioId: fixture.mock.id })) {
        if (cancelled) return;
        setEvents((previous) => [...previous, event]);
        if (event.type === "stream-chunk" && event.chunk.kind === "text") {
          setStreamText((previous) => `${previous}${previous ? " " : ""}${event.chunk.value}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoStream, fixture.mock, model]);

  const error = activeCard.status === "failed" || fixture.mock.state === "error" || fixture.mock.state === "timeout";
  const detailsId = `storybook-360-details-${fixture.id}`;
  const accessibleName = `${display.title}${display.label ? `, ${display.label}` : ""}${expanded ? ". Collapse details" : ". Expand details"}`;

  return (
    <main className="shell" aria-label="Storybook 360 MCP fixture">
      <section className={`tool-card ${display.tone}${error ? " state-error" : ""}`} aria-label={`${display.title} result`}>
        <button
          className="tool-header"
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={accessibleName}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="tool-icon" aria-hidden="true">◆</span>
          <span className="tool-main">
            <span className="tool-title">{display.title}</span>
            {display.label ? <span className="tool-label">{display.label}</span> : null}
          </span>
          <span className="header-meta" aria-label={fixture.label}>{fixture.label}</span>
          <span className="chevron" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
        </button>
        {expanded ? (
          <div className="tool-body" id={detailsId} role="region" aria-label={`${display.title} details`}>
            <div className={`status ${error ? "error" : "muted"}`} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}>
              {statusText(fixture, attempted)}
            </div>
            {fixture.mock.toolCalls?.length ? (
              <ul aria-label="Tool calls">
                {fixture.mock.toolCalls.map((call) => <li key={call.name}>{call.name}</li>)}
              </ul>
            ) : null}
            {autoStream ? <output aria-label="Streaming output" aria-live="polite">{streamText || "Waiting for stream…"}</output> : null}
            {!autoStream && payloadText(activeCard.payload) ? <pre tabIndex={0}>{payloadText(activeCard.payload)}</pre> : null}
            {fixture.mock.state === "retry" && !attempted ? (
              <button type="button" onClick={() => setAttempted(true)}>Try again</button>
            ) : null}
            <small data-testid="mock-events">{events.length} deterministic events</small>
          </div>
        ) : null}
      </section>
    </main>
  );
}

const meta = {
  title: "Storybook 360 MCP/ToolResultCard",
  component: ToolResultCardStory,
  parameters: {
    msw: storybookMockHandlers,
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ToolResultCardStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = { args: { fixtureId: "read-success" } };
export const Error: Story = { args: { fixtureId: "write-error" } };
export const Empty: Story = { args: { fixtureId: "glob-empty" } };
export const Loading: Story = { args: { fixtureId: "workspace-loading" } };
export const Timeout: Story = { args: { fixtureId: "bash-timeout" } };
export const RetryAndToolCalling: Story = {
  args: { fixtureId: "exec-retry-tool-call" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Ran command/i }));
    await expect(canvas.getByRole("button", { name: "Try again" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(canvas.getByText("Retry succeeded.")).toBeVisible();
  },
};
export const Streaming: Story = {
  args: { fixtureId: "streaming-read", autoStream: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Streaming output")).toHaveTextContent("chunk one chunk two");
    await expect(canvas.getByRole("list", { name: "Tool calls" })).toBeVisible();
  },
};
