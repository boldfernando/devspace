import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import "./json-render-app.css";

/**
 * The renderer, React DOM, and the catalog validator are all pulled in
 * dynamically. Nothing heavier than this shell is downloaded until a spec
 * actually arrives, which keeps the initial panel payload small.
 */
type ExtAppsModule = typeof import("@modelcontextprotocol/ext-apps");
type RendererModule = typeof import("./json-render-renderer.js");

interface RenderPayload {
  title?: string;
  spec: unknown;
}

const container = document.getElementById("json-render-app");
let rendererModule: RendererModule | null = null;
let mounted = false;
let renderToken = 0;

function payloadFromResult(result: CallToolResult): RenderPayload | undefined {
  const meta = result._meta as Record<string, unknown> | undefined;
  const payload = meta?.jsonRender;
  if (!payload || typeof payload !== "object") return undefined;

  const candidate = payload as { title?: unknown; spec?: unknown };
  if (!candidate.spec) return undefined;

  return {
    ...(typeof candidate.title === "string" ? { title: candidate.title } : {}),
    spec: candidate.spec,
  };
}

function renderMessage(message: string): void {
  if (!container) return;
  if (mounted) {
    rendererModule?.unmountSpec(container);
    mounted = false;
  }

  const section = document.createElement("section");
  section.className = "jr-empty";
  section.setAttribute("role", "status");
  section.setAttribute("aria-live", "polite");
  section.textContent = message;
  container.replaceChildren(section);
}

async function renderSpec(payload: RenderPayload): Promise<void> {
  if (!container) return;
  const token = ++renderToken;

  if (!rendererModule) {
    try {
      const loaded = await import("./json-render-renderer.js");
      if (token !== renderToken) return;
      rendererModule = loaded;
    } catch {
      renderMessage("The renderer could not be loaded. Ask the host to retry the operation.");
      return;
    }
  }

  // The host is untrusted from this app's point of view, so the spec is
  // re-validated here instead of being rendered on the server's word alone.
  if (!rendererModule.isRenderableSpec(payload.spec)) {
    renderMessage("This result could not be displayed: it does not match the component catalog.");
    return;
  }

  if (token !== renderToken) return;
  rendererModule.renderSpec(container, payload);
  mounted = true;
}

async function connect(): Promise<void> {
  let extApps: ExtAppsModule;
  try {
    extApps = await import("@modelcontextprotocol/ext-apps");
  } catch {
    renderMessage("Could not connect to the host. Ask the host to retry the operation.");
    return;
  }

  const app = new extApps.App({ name: "devspace-json-render", version: "0.1.0" }, {});

  app.ontoolresult = (result) => {
    const payload = payloadFromResult(result);
    if (!payload) {
      renderMessage("This tool result carried no UI spec.");
      return;
    }

    void renderSpec(payload);
  };

  try {
    await app.connect();
  } catch {
    renderMessage("Could not connect to the host. Ask the host to retry the operation.");
  }
}

void connect();
