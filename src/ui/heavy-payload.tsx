import { lazy, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  isEditTool,
  isReadTool,
  isWriteTool,
  payloadText,
  summaryNumber,
  type HostContext,
  type ToolResultCard,
} from "./card-types.js";
import { pierrePrettyScrollbarCss } from "./scrollbar.js";

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
  root.render(<HeavyPayload {...options} />);

  return {
    update(nextOptions) {
      root.render(<HeavyPayload {...nextOptions} />);
    },
    unmount() {
      root.unmount();
    },
  };
}

export type { MountedPayload, PayloadRendererOptions };

function HeavyPayload({
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

  return <pre className={`text-payload pretty-scrollbar ${card.tool}`}>{text}</pre>;
}

function StatusLine({
  message,
  tone = "muted",
}: {
  message: string;
  tone?: "muted" | "error";
}) {
  return <div className={`status ${tone}`}>{message}</div>;
}
