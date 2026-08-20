import { lazy, memo, Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
  isEditTool,
  isReadTool,
  isWriteTool,
  payloadText,
  summaryNumber,
  type HostContext,
  type ToolResultCard,
} from "./card-types.js";

type ThemeType = "light" | "dark";
const LazyFilePayload = lazy(() => import("./file-payload.js").then((module) => ({ default: module.FilePayload })));
const LazyDiffPayload = lazy(() => import("./diff-payload.js").then((module) => ({ default: module.DiffPayload })));

interface PayloadRendererOptions {
  card: ToolResultCard;
  hostContext?: HostContext;
  errorMessage?: string | null;
}

interface MountedPayload {
  update(options: PayloadRendererOptions): void;
  unmount(): void;
}

export function mountHeavyPayload(
  container: HTMLElement,
  options: PayloadRendererOptions,
): MountedPayload {
  const root = createRoot(container);
  let currentOptions = options;
  root.render(<HeavyPayload {...currentOptions} />);

  return {
    update(nextOptions) {
      if (payloadOptionsEqual(currentOptions, nextOptions)) return;
      currentOptions = nextOptions;
      root.render(<HeavyPayload {...currentOptions} />);
    },
    unmount() {
      root.unmount();
    },
  };
}

export type { MountedPayload, PayloadRendererOptions };

const HeavyPayload = memo(function HeavyPayload({
  card,
  hostContext,
  errorMessage = null,
}: PayloadRendererOptions) {
  const themeType: ThemeType = hostContext?.theme === "light" ? "light" : "dark";

  if (errorMessage) {
    return <StatusLine message={errorMessage} tone="error" />;
  }

  if (isEditTool(card.tool) || isWriteTool(card.tool)) {
    const patch = card.payload?.patch || card.payload?.diff;
    if (!patch) return <StatusLine message="Diff payload is not available." />;

    return <Suspense fallback={<StatusLine message="Loading diff renderer..." />}><LazyDiffPayload patch={patch} themeType={themeType} /></Suspense>;
  }

  const text = payloadText(card.payload);
  if (!text) return <StatusLine message="No details available." />;

  if (isReadTool(card.tool)) {
    return (
      <Suspense fallback={<StatusLine message="Loading file renderer..." />}>
      <LazyFilePayload
        path={card.path ?? "file"}
        text={text}
        startLine={summaryNumber(card.summary, "offset") ?? 1}
        themeType={themeType}
      />
      </Suspense>
    );
  }

  return (
    <pre
      className={`text-payload pretty-scrollbar ${card.tool}`}
      tabIndex={0}
      aria-label={`${card.tool} output. Scroll to read the complete result.`}
    >
      {text}
    </pre>
  );
}, payloadOptionsEqual);

function payloadOptionsEqual(
  previous: PayloadRendererOptions,
  next: PayloadRendererOptions,
): boolean {
  return previous.card === next.card
    && previous.errorMessage === next.errorMessage
    && previous.hostContext?.theme === next.hostContext?.theme;
}

function StatusLine({
  message,
  tone = "muted",
}: {
  message: string;
  tone?: "muted" | "error";
}) {
  return (
    <div
      className={`status ${tone}`}
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {message}
    </div>
  );
}
