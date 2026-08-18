import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  isEditTool,
  isExpandableCard,
  isInitiallyExpandedCard,
  isPatchTool,
  isReadTool,
  isReviewTool,
  isToolName,
  isToolResultCard,
  isWriteTool,
  payloadText,
  type HostContext,
  type ToolName,
  type ToolResultCard,
} from "./card-types.js";
import { getProviderLogo, renderIcon, toolIcons, type ToolIcon } from "./icons.js";
import {
  completedJourneyStages,
  initialJourneyProgress,
  journeyProgressPercent,
  journeyStageLabel,
  journeyStages,
  nextJourneyStep,
  updateJourneyProgress,
  type JourneyProgress,
} from "./journey-progress.js";
import {
  getToolDisplay,
  getToolHeaderSummary,
  type ToolDisplay,
} from "./tool-display.js";
import { withContentFallback } from "./card-result-normalizer.js";
import { shouldUpdateToolResultInPlace } from "./render-strategy.js";
import {
  beginConnection,
  beginRender,
  initialUiSyncState,
  isCurrentConnection,
  isCurrentRender,
} from "./sync-state.js";
import "./workspace-app.css";

interface MountedPayload {
  update(options: {
    card: ToolResultCard;
    hostContext?: HostContext;
    errorMessage?: string | null;
  }): void;
  unmount(): void;
}

type ExtAppsModule = typeof import("@modelcontextprotocol/ext-apps");
let app: App | null = null;
let extAppsModule: ExtAppsModule | null = null;
let connected = false;
let connectionError: string | null = null;
let hostContext: HostContext | undefined;
let card: ToolResultCard | null = null;
let expanded = false;
let errorMessage: string | null = null;
let currentPayload: MountedPayload | null = null;
let currentPayloadContainer: HTMLElement | null = null;
let openWorkspaceInstructionKey: string | null = null;
let showAvailableWorkspaceInstructions = false;
let journeyProgress: JourneyProgress = initialJourneyProgress();
let journeyProgressExpanded = false;
let milestoneMessage: string | null = null;
let journeyProgressContainer: HTMLElement | null = null;
let uiSyncState = initialUiSyncState;
let activeRenderRevision = 0;

const maybeAppRoot = document.querySelector<HTMLElement>("#app");

if (!maybeAppRoot) {
  throw new Error("Missing #app root element.");
}

const appRoot = maybeAppRoot;

void boot();

async function boot(): Promise<void> {
  const connectionStart = beginConnection(uiSyncState);
  uiSyncState = connectionStart.state;
  const connectionEpoch = connectionStart.value;
  connected = false;
  connectionError = null;
  card = null;
  expanded = false;
  errorMessage = null;
  openWorkspaceInstructionKey = null;
  showAvailableWorkspaceInstructions = false;
  unmountPayload();
  app = null;
  render();

  let nextApp: App;
  try {
    const nextExtAppsModule = await import("@modelcontextprotocol/ext-apps");
    if (!isCurrentConnection(uiSyncState, connectionEpoch)) return;
    extAppsModule = nextExtAppsModule;
    nextApp = new extAppsModule.App(
      { name: "devspace-tool-cards", version: "0.4.0" },
      {},
    );
    app = nextApp;
  } catch (loadError) {
    if (!isCurrentConnection(uiSyncState, connectionEpoch)) return;
    connectionError = loadError instanceof Error
      ? loadError.message
      : "The host client could not be loaded.";
    render();
    return;
  }

  nextApp.ontoolresult = (result) => {
    if (!isCurrentConnection(uiSyncState, connectionEpoch)) return;

    const structuredContent = getStructuredContent<Partial<ToolResultCard>>(result);
    const metaCard = cardFromMeta(result);
    const structured = metaCard
      ? { ...structuredContent, ...metaCard }
      : structuredContent;
    const tool = toolNameFromMeta(result);

    if (!tool || !isToolResultCard(structured)) {
      card = null;
      expanded = false;
      openWorkspaceInstructionKey = null;
      showAvailableWorkspaceInstructions = false;
      errorMessage = "This tool result could not be displayed. Ask the host to retry the operation.";
      render();
      return;
    }

    const nextCard = withContentFallback({ ...structured, tool }, result);
    const previousCard = card;
    const previousExpanded = expanded;
    const nextExpanded = previousCard?.tool === nextCard.tool
      ? previousExpanded
      : isInitiallyExpandedCard(nextCard);
    const updateInPlace = shouldUpdateToolResultInPlace(
      previousCard,
      nextCard,
      previousExpanded,
      nextExpanded,
      Boolean(currentPayload),
    );
    card = nextCard;
    const progressUpdate = updateJourneyProgress(journeyProgress, tool);
    journeyProgress = progressUpdate.progress;
    milestoneMessage = progressUpdate.completedStage
      ? `${journeyStageLabel(progressUpdate.completedStage)}. ${nextJourneyStep(journeyProgress)}`
      : null;
    expanded = nextExpanded;
    openWorkspaceInstructionKey = null;
    showAvailableWorkspaceInstructions = false;
    errorMessage = null;
    if (updateInPlace && updateRenderedCardInPlace(nextCard)) return;
    render();

  };

    nextApp.onhostcontextchanged = (ctx) => {
    if (!isCurrentConnection(uiSyncState, connectionEpoch)) return;
    hostContext = {

      ...hostContext,
      ...ctx,
    };
    applyHostContext();
    // Workspace details inherit host variables directly. Rebuilding their DOM on
    // iframe resize would reset an in-progress instruction preview interaction.
    if (card?.tool !== "open_workspace") renderPayloadIfNeeded();
  };

    nextApp.onteardown = async () => {
    if (!isCurrentConnection(uiSyncState, connectionEpoch)) return {};
    connected = false;
    card = null;
    expanded = false;
    errorMessage = null;
    unmountPayload();
    render();
    return {};
  };

  try {
    await nextApp.connect();
    if (!isCurrentConnection(uiSyncState, connectionEpoch)) return;
    const initialContext = nextApp.getHostContext();
    if (initialContext) hostContext = initialContext;
    applyHostContext();
    connected = true;
  } catch (connectError) {
    if (!isCurrentConnection(uiSyncState, connectionEpoch)) return;
    connectionError = connectError instanceof Error
      ? connectError.message
      : String(connectError);
  }

  if (isCurrentConnection(uiSyncState, connectionEpoch)) render();

}

function updateRenderedCardInPlace(nextCard: ToolResultCard): boolean {
  const header = appRoot.querySelector<HTMLButtonElement>(".tool-header");
  const display = getToolDisplay(nextCard);
  if (!header) return false;

  const existingLabel = header.querySelector<HTMLElement>(".tool-label");
  if (Boolean(existingLabel) !== Boolean(display.label)) return false;
  if (existingLabel && display.label) {
    existingLabel.textContent = display.label;
    existingLabel.title = display.label;
  }

  const summary = header.querySelector<HTMLElement>(".stats, .header-meta");
  if (summary) summary.replaceWith(renderHeaderSummary(nextCard));
  header.setAttribute(
    "aria-label",
    `${display.title}${display.label ? `, ${display.label}` : ""}. ${expanded ? "Collapse" : "Expand"} details`,
  );

  if (journeyProgressContainer?.isConnected) {
    journeyProgressContainer.replaceWith(renderJourneyProgress());
  }
  void renderPayloadIfNeeded();
  return true;
}

function applyHostContext(): void {

  if (hostContext?.theme && extAppsModule) extAppsModule.applyDocumentTheme(hostContext.theme);
  if (hostContext?.styles?.variables) {
    extAppsModule?.applyHostStyleVariables(hostContext.styles.variables);
  }
  if (hostContext?.styles?.css?.fonts) {
    extAppsModule?.applyHostFonts(hostContext.styles.css.fonts);
  }

  const insets = hostContext?.safeAreaInsets;
  if (!insets) return;

  document.body.style.padding = `${insets.top}px ${insets.right}px ${insets.bottom}px ${insets.left}px`;
}

function render(): void {
  const renderStart = beginRender(uiSyncState);
  uiSyncState = renderStart.state;
  activeRenderRevision = renderStart.value;
  unmountPayload();

  if (connectionError) {
    renderConnectionError(connectionError);
    return;
  }

  if (!connected) {
    renderConnecting();
    return;
  }

  if (!card) {
    renderWaiting(errorMessage ?? "Waiting for a tool result.", Boolean(errorMessage));
    return;
  }

  const display = getToolDisplay(card);
  if (isReviewTool(card.tool)) {
    renderReviewCard(card, display);
    return;
  }

  const expandable = isExpandableCard(card);
  const detailsId = "tool-card-details";
  const main = element("main", { className: "shell" });
  main.append(renderJourneyProgress());
  const section = element("section", {
    className: toolCardClassName(display),
    ariaLabel: `${display.title} result`,
  });
  const button = element("button", {
    className: "tool-header",
    type: "button",
    ariaExpanded: String(expanded),
    ariaControls: expandable ? detailsId : undefined,
    ariaLabel: expandable
      ? `${display.title}${display.label ? `, ${display.label}` : ""}. ${expanded ? "Collapse" : "Expand"} details`
      : `${display.title}${display.label ? `, ${display.label}` : ""} result`,
    disabled: !expandable,
  });

  if (expandable) {
    button.addEventListener("click", () => {
      expanded = !expanded;
      render();
    });
  }

  const icon = element("span", { className: "tool-icon", ariaHidden: "true" });
  icon.append(renderIcon(display.icon));

  const toolMain = element("span", { className: "tool-main" });
  const title = element("span", {
    className: "tool-title",
    text: display.title,
    id: "tool-card-title",
  });
  toolMain.append(title);
  if (display.label) {
    toolMain.append(element("span", {
      className: "tool-label",
      text: display.label,
      title: display.label,
    }));
  }

  button.append(
    icon,
    toolMain,
    renderHeaderSummary(card),
    renderChevron(expanded, expandable),
  );
  section.append(button);

  if (expanded) {
    const body = element("div", {
      className: "tool-body",
      id: detailsId,
      role: "region",
      ariaLabel: `${display.title} details`,
    });
    currentPayloadContainer = body;
    section.append(body);
  }

  main.append(section);
  appRoot.replaceChildren(main);
  renderPayloadIfNeeded();
}

function renderWaiting(message: string, isError: boolean): void {
  const main = element("main", { className: "shell" });
  main.append(renderJourneyProgress());
  main.append(element("section", {
    className: `empty journey-waiting${isError ? " error" : ""}`,
    text: message,
    role: isError ? "alert" : "status",
    ariaLive: isError ? "assertive" : "polite",
    ariaAtomic: "true",
  }));
  appRoot.replaceChildren(main);
}

function renderJourneyProgress(): HTMLElement {
  const completed = completedJourneyStages(journeyProgress);
  const percent = journeyProgressPercent(journeyProgress);
  const detailsId = "journey-progress-details";
  const section = element("section", {
    className: "journey-progress",
    ariaLabel: "Workflow progress",
  });
  journeyProgressContainer = section;
  const header = element("div", { className: "journey-progress-header" });
  const titleGroup = element("div", { className: "journey-progress-title-group" });
  titleGroup.append(
    element("strong", { className: "journey-progress-title", text: "Workflow progress" }),
    element("span", {
      className: "journey-progress-count",
      text: `${completed}/${journeyStages.length} milestones`,
    }),
  );
  const toggle = element("button", {
    className: "journey-progress-toggle",
    type: "button",
    text: journeyProgressExpanded ? "Hide steps" : "View steps",
    ariaExpanded: String(journeyProgressExpanded),
    ariaControls: detailsId,
    ariaLabel: journeyProgressExpanded
      ? "Hide workflow milestones"
      : "View workflow milestones",
  });
  toggle.addEventListener("click", () => {
    journeyProgressExpanded = !journeyProgressExpanded;
    if (journeyProgressContainer?.isConnected) {
      journeyProgressContainer.replaceWith(renderJourneyProgress());
    } else {
      render();
    }
  });
  header.append(titleGroup, toggle);

  const track = element("div", {
    className: "journey-progress-track",
    role: "progressbar",
    ariaLabel: `Workflow progress: ${percent}% complete`,
  });
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.setAttribute("aria-valuenow", String(percent));
  const fill = element("span", { className: "journey-progress-fill" });
  fill.style.width = `${percent}%`;
  track.append(fill);

  section.append(header, track, element("span", {
    className: "journey-progress-next",
    text: nextJourneyStep(journeyProgress),
  }));

  if (milestoneMessage) {
    section.append(element("div", {
      className: "journey-milestone",
      text: milestoneMessage,
      role: "status",
      ariaLive: "polite",
      ariaAtomic: "true",
    }));
  }

  if (journeyProgressExpanded) {
    const steps = element("ol", {
      className: "journey-progress-steps",
      id: detailsId,
      ariaLabel: "Workflow milestones",
    });
    for (const stage of journeyStages) {
      const complete = journeyProgress[stage];
      const step = element("li", {
        className: `journey-progress-step${complete ? " complete" : ""}`,
      });
      step.append(
        element("span", {
          className: "journey-progress-step-mark",
          text: complete ? "✓" : "○",
          ariaHidden: "true",
        }),
        element("span", {
          className: "journey-progress-step-label",
          text: journeyStageLabel(stage),
        }),
      );
      steps.append(step);
    }
    section.append(steps);
  }

  return section;
}

function renderConnecting(): void {
  const main = element("main", { className: "shell" });
  const panel = element("section", {
    className: "empty connection-loading",
    role: "status",
    ariaLabel: "Connecting to the host",
    ariaLive: "polite",
    ariaAtomic: "true",
    ariaBusy: "true",
  });
  panel.append(
    element("strong", {
      className: "connection-loading-title",
      text: "Connecting to host…",
    }),
    element("span", {
      className: "connection-loading-detail",
      text: "Waiting for the host handshake before showing tool results.",
    }),
  );
  main.append(panel);
  appRoot.replaceChildren(main);
}

function renderConnectionError(message: string): void {
  const main = element("main", { className: "shell" });
  const panel = element("section", {
    className: "empty error connection-error",
    role: "alert",
    ariaLabel: "Unable to connect to the host",
    ariaLive: "assertive",
    ariaAtomic: "true",
  });
  const title = element("strong", {
    className: "connection-error-title",
    text: "Unable to connect to the host",
  });
  const detail = element("span", {
    className: "connection-error-detail",
    text: message,
  });
  const retry = element("button", {
    className: "connection-retry",
    type: "button",
    text: "Try again",
    ariaLabel: "Try connecting to the host again",
  });
  retry.addEventListener("click", () => {
    void boot();
  });
  panel.append(title, detail, retry);
  main.append(panel);
  appRoot.replaceChildren(main);
}

function renderEmpty(message: string, tone: "muted" | "error" = "muted"): void {
  const main = element("main", { className: "shell" });
  main.append(element("section", {
    className: `empty ${tone}`,
    text: message,
    role: tone === "error" ? "alert" : "status",
    ariaLive: tone === "error" ? "assertive" : "polite",
    ariaAtomic: "true",
  }));
  appRoot.replaceChildren(main);
}

async function renderPayloadIfNeeded(
  expectedRenderRevision = activeRenderRevision,
): Promise<void> {
  if (!isCurrentRender(uiSyncState, expectedRenderRevision)) return;
  if (!card || !currentPayloadContainer || !expanded) return;

  const target = currentPayloadContainer;

  if (errorMessage) {
    renderStatus(target, errorMessage, "error");
    return;
  }

  if (card.tool === "open_workspace") {
    renderWorkspacePayload(target, card);
    return;
  }

  if (shouldUseHeavyPayload(card)) {
    if (currentPayload) {
      currentPayload.update({ card, hostContext, errorMessage });
      return;
    }

    setPayloadLoading(target, true);

    try {
      const { mountHeavyPayload } = await import("./heavy-payload.js");
      if (
        !isCurrentRender(uiSyncState, expectedRenderRevision) ||
        target !== currentPayloadContainer ||
        !expanded ||
        !card
      ) return;

      setPayloadLoading(target, false);
      currentPayload = mountHeavyPayload(target, {
        card,
        hostContext,
        errorMessage,
      });
    } catch (loadError) {
      if (target !== currentPayloadContainer || !expanded) return;

      setPayloadLoading(target, false);
      renderStatus(
        target,
        loadError instanceof Error ? loadError.message : "Unable to load details.",
        "error",
      );
    }
    return;
  }

  if (isReviewTool(card.tool) || isPatchTool(card.tool)) {
    if (currentPayload) {
      currentPayload.update({ card, hostContext, errorMessage });
      return;
    }

    renderStatus(target, isReviewTool(card.tool) ? "Loading review..." : "Loading diff...");

    const { mountReviewPayload } = await import("./review-payload.js");
    if (
      !isCurrentRender(uiSyncState, expectedRenderRevision) ||
      target !== currentPayloadContainer ||
      !card
    ) return;

    currentPayload = mountReviewPayload(target, {
      card,
      hostContext,
      errorMessage,
    });
    return;
  }

  const text = payloadText(card.payload);
  if (!text) {
    renderStatus(target, "No details available.");
    return;
  }

  renderPrePayload(target, text, card.tool);
}

function shouldUseHeavyPayload(card: ToolResultCard): boolean {
  return isReadTool(card.tool) || isEditTool(card.tool) || isWriteTool(card.tool);
}

function unmountPayload(): void {
  unmountCurrentPayload();
  currentPayload = null;
  currentPayloadContainer = null;
}

function unmountCurrentPayload(): void {
  currentPayload?.unmount();
  currentPayload = null;
}

function renderStatus(
  container: HTMLElement,
  message: string,
  tone: "muted" | "error" = "muted",
): void {
  unmountCurrentPayload();
  container.replaceChildren(element("div", {
    className: `status ${tone}`,
    text: message,
    role: tone === "error" ? "alert" : "status",
    ariaLive: tone === "error" ? "assertive" : "polite",
    ariaAtomic: "true",
  }));
}

function renderPrePayload(
  container: HTMLElement,
  text: string,
  tool: string,
): void {
  unmountCurrentPayload();
  container.replaceChildren(element("pre", {
    className: `text-payload pretty-scrollbar ${tool}`,
    text,
    tabIndex: 0,
    ariaLabel: `${tool} output. Scroll to read the complete result.`,
  }));
}

function renderHeaderSummary(card: ToolResultCard): HTMLElement {
  const summary = getToolHeaderSummary(card);

  if (summary.kind === "diff") {
    const stats = element("span", { className: "stats" });
    stats.setAttribute(
      "aria-label",
      `Diff statistics: ${summary.additions} additions, ${summary.removals} removals`,
    );
    stats.append(
      element("span", { className: "add", text: `+${String(summary.additions)}`, ariaHidden: "true" }),
      element("span", { className: "remove", text: `-${String(summary.removals)}`, ariaHidden: "true" }),
    );
    return stats;
  }

  const meta = element("span", {
    className: `header-meta ${summary.kind === "empty" ? "empty" : ""}`,
    text: summary.kind === "text" ? summary.text : "",
  });
  if (summary.kind === "empty") meta.setAttribute("aria-hidden", "true");
  if (summary.kind === "text") meta.setAttribute("aria-label", summary.text);
  return meta;
}

function renderReviewCard(card: ToolResultCard, display: ToolDisplay): void {
  const expandable = isExpandableCard(card);
  const detailsId = "review-card-details";
  const main = element("main", { className: "shell" });
  main.append(renderJourneyProgress());
  const section = element("section", {
    className: toolCardClassName(display),
    ariaLabel: `${display.title} result`,
  });
  const header = element("button", {
    className: "tool-header review-header",
    type: "button",
    ariaExpanded: String(expanded),
    ariaControls: expandable ? detailsId : undefined,
    ariaLabel: expandable
      ? `${display.title}${display.label ? `, ${display.label}` : ""}. ${expanded ? "Collapse" : "Expand"} details`
      : `${display.title}${display.label ? `, ${display.label}` : ""} result`,
    disabled: !expandable,
  });

  if (expandable) {
    header.addEventListener("click", () => {
      expanded = !expanded;
      render();
    });
  }

  const icon = element("span", { className: "tool-icon", ariaHidden: "true" });
  icon.append(renderIcon(display.icon));
  const titleGroup = element("span", { className: "tool-main review-title-group" });

  titleGroup.append(element("span", {
    className: "tool-title",
    text: display.title,
    id: "review-card-title",
  }));
  if (display.label) {
    titleGroup.append(element("span", {
      className: "tool-label",
      text: display.label,
      title: display.label,
    }));
  }
  header.append(
    icon,
    titleGroup,
    renderHeaderSummary(card),
    renderChevron(expanded, expandable),
  );

  section.append(header);
  if (expanded) {
    const body = element("div", {
      className: "review-summary",
      id: detailsId,
      role: "region",
      ariaLabel: `${display.title} details`,
    });
    const payload = element("div", { className: "review-payload" });
    currentPayloadContainer = payload;
    body.append(payload);

    section.append(body);
  }

  main.append(section);
  appRoot.replaceChildren(main);
  renderPayloadIfNeeded();
}

function renderChevron(isExpanded: boolean, visible: boolean): HTMLElement {
  const chevron = element("span", {
    className: visible ? `chevron ${isExpanded ? "expanded" : ""}` : "chevron",
    ariaHidden: "true",
  });

  if (visible) {
    chevron.append(renderIcon(toolIcons.chevronDown));
  }

  return chevron;
}

function toolCardClassName(display: ToolDisplay): string {
  return ["tool-card", display.tone, display.state ? `state-${display.state}` : undefined]
    .filter(Boolean)
    .join(" ");
}

function setPayloadLoading(container: HTMLElement, loading: boolean): void {
  const header = container.previousElementSibling;
  const chevron = header?.querySelector<HTMLElement>(".chevron");
  if (!chevron) return;

  chevron.classList.toggle("loading", loading);
  chevron.replaceChildren(
    renderIcon(loading ? toolIcons.loading : toolIcons.chevronDown),
  );

  const button = header instanceof HTMLButtonElement ? header : null;
  if (button) button.setAttribute("aria-busy", String(loading));
}

function renderWorkspacePayload(container: HTMLElement, card: ToolResultCard): void {
  unmountCurrentPayload();

  const details = element("div", {
    className: "workspace-details pretty-scrollbar",
  });
  const rows = element("div", { className: "workspace-rows" });
  const worktree = card.worktree;

  if (worktree) {
    const base = [
      worktree.baseRef,
      worktree.baseSha?.slice(0, 8),
    ].filter((value): value is string => Boolean(value));
    const baseLabel = base.join(" · ") || "Worktree";
    const baseContent = element("span", { className: "workspace-base-value" });
    baseContent.append(element("span", {
      className: "workspace-value",
      text: baseLabel,
      title: baseLabel,
    }));

    if (worktree.dirtySource) {
      const warning = element("span", {
        className: "workspace-base-warning",
        title: "The source checkout had uncommitted changes when this worktree was created. Those changes are not included here.",
        ariaLabel: "Source checkout changes are not included in this worktree",
      });
      warning.append(renderIcon(toolIcons.warning, "workspace-base-warning-svg"));
      baseContent.append(warning);
    }

    appendWorkspaceRow(rows, "Base", baseContent, toolIcons.base);
  }

  if (card.sourceRoot && card.sourceRoot !== card.root) {
    appendWorkspaceTextRow(
      rows,
      "Source checkout",
      card.sourceRoot,
      toolIcons.sourceCheckout,
      true,
    );
  }

  appendWorkspaceInstructions(
    rows,
    card.agentsFiles ?? [],
    card.availableAgentsFiles ?? [],
  );

  const skills = card.skills ?? [];
  if (skills.length > 0) {
    appendWorkspaceSkills(rows, skills);
  }

  const providers = card.agentProviders ?? [];
  const agents = card.agents ?? [];
  const agentChips: WorkspaceChip[] = agents.map((agent) => {
    const name = agent.name ?? "Unnamed agent";
    const providerName = agent.provider?.trim();
    const unavailable = agent.providerAvailable === false;
    const title = [
      agent.description,
      providerName ? `Provider: ${providerName}` : undefined,
      agent.model ? `Model: ${agent.model}` : undefined,
      agent.thinking ? `Thinking: ${agent.thinking}` : undefined,
      unavailable
        ? agent.providerUnavailableReason ?? "Provider unavailable"
        : undefined,
    ].filter((value): value is string => Boolean(value)).join("\n");
    return {
      label: name,
      logo: providerName ? getProviderLogo(providerName) : undefined,
      profile: true,
      tone: unavailable ? "muted" as const : undefined,
      title: title || undefined,
    };
  });
  const providerChips: WorkspaceChip[] = providers.map((provider) => {
    const name = provider.name?.trim() || "Unknown provider";
    const unavailable = provider.available === false;
    const logo = getProviderLogo(name);
    return {
      label: name,
      logo,
      bareLogo: Boolean(logo),
      ariaLabel: name,
      tone: unavailable ? "muted" as const : undefined,
      title: unavailable ? provider.reason ?? "Provider unavailable" : name,
    };
  });

  if (agentChips.length > 0) {
    const chipList = renderWorkspaceChips([...agentChips, ...providerChips]);
    chipList.classList.add("workspace-agents-list");
    appendWorkspaceRow(rows, "Agents", chipList, toolIcons.agents, "workspace-agents-row");
  } else if (providerChips.length > 0) {
    appendWorkspaceChipRow(rows, "Providers", providerChips, toolIcons.providers);
  }

  if (rows.childElementCount > 0) details.append(rows);

  if (details.childElementCount === 0) {
    details.append(element("div", { className: "status muted", text: "No workspace details available." }));
  }

  container.replaceChildren(details);
}

interface WorkspaceChip {
  label: string;
  logo?: string;
  profile?: boolean;
  bareLogo?: boolean;
  ariaLabel?: string;
  title?: string;
  tone?: "muted";
}

interface WorkspaceInstruction {
  key: string;
  path?: string;
  label: string;
  content?: string;
  status: "loaded" | "available";
}

function appendWorkspaceInstructions(
  container: HTMLElement,
  loadedFiles: NonNullable<ToolResultCard["agentsFiles"]>,
  availableFiles: NonNullable<ToolResultCard["availableAgentsFiles"]>,
): void {
  const loaded: WorkspaceInstruction[] = [];
  const loadedPaths = new Set<string>();
  for (const [index, file] of loadedFiles.entries()) {
    loaded.push({
      key: `loaded:${index}`,
      path: file.path,
      label: file.path ?? "Loaded instructions",
      content: file.content,
      status: "loaded",
    });
    if (file.path) loadedPaths.add(file.path);
  }

  const available: WorkspaceInstruction[] = [];
  for (const [index, file] of availableFiles.entries()) {
    if (file.path && loadedPaths.has(file.path)) continue;
    available.push({
      key: `available:${index}`,
      path: file.path,
      label: file.path ?? "Nested instructions",
      status: "available",
    });
  }
  if (loaded.length === 0 && available.length === 0) return;

  const instructions = showAvailableWorkspaceInstructions
    ? [...loaded, ...available]
    : loaded;
  const list = renderWorkspaceInstructionList(instructions);

  if (available.length > 0) {
    const showAll = showAvailableWorkspaceInstructions;
    const toggle = element("button", {
      className: "workspace-instructions-toggle",
      type: "button",
      text: showAll ? "Show less" : "View all",
      ariaLabel: showAll
        ? "Show only loaded instruction files"
        : `View all ${available.length} available instruction files`,
      ariaExpanded: String(showAll),
    });
    toggle.addEventListener("click", () => {
      showAvailableWorkspaceInstructions = !showAvailableWorkspaceInstructions;
      if (!showAvailableWorkspaceInstructions) openWorkspaceInstructionKey = null;
      render();
    });
    list.append(toggle);
  }

  const content = element("div", { className: "workspace-instructions-content" });
  content.append(list);

  appendWorkspaceRow(
    container,
    "Instructions",
    content,
    toolIcons.instructions,
    "workspace-instructions-row",
  );
}

function renderWorkspaceInstructionList(
  instructions: WorkspaceInstruction[],
): HTMLElement {
  const list = element("span", { className: "workspace-instruction-list" });

  for (const instruction of instructions) {
    const item = element("span", { className: "workspace-instruction-item" });
    item.dataset.instructionKey = instruction.key;
    const hasContent = instruction.status === "loaded" && instruction.content !== undefined;
    const header = element(hasContent ? "button" : "span", {
      className: `workspace-instruction-header${hasContent ? " interactive" : ""}`,
      type: hasContent ? "button" : undefined,
      ariaLabel: hasContent ? `View ${instruction.label}` : undefined,
      ariaExpanded: hasContent ? "false" : undefined,
    });
    const text = element("span", { className: "workspace-instruction-text" });
    const basename = workspacePathBasename(instruction.label);
    text.append(element("span", {
      className: "workspace-instruction-name",
      text: basename,
    }));
    if (instruction.path && instruction.path !== basename) {
      text.append(element("span", {
        className: "workspace-instruction-path",
        text: instruction.path,
        title: instruction.path,
      }));
    }

    header.append(
      renderWorkspaceInstructionStatus(instruction.status),
      text,
    );

    if (hasContent) {
      const chevron = element("span", {
        className: "workspace-instruction-chevron",
        ariaHidden: "true",
      });
      chevron.append(renderIcon(toolIcons.chevronDown, "workspace-instruction-chevron-svg"));
      header.append(chevron);
      header.addEventListener("click", () => {
        openWorkspaceInstructionKey = openWorkspaceInstructionKey === instruction.key
          ? null
          : instruction.key;
        syncWorkspaceInstructionPreviews(list);
      });

      const preview = element("pre", {
        className: "workspace-instruction-preview pretty-scrollbar",
        text: instruction.content,
      });
      preview.hidden = true;
      item.append(header, preview);
    } else {
      item.append(header);
    }

    list.append(item);
  }

  syncWorkspaceInstructionPreviews(list);
  return list;
}

function syncWorkspaceInstructionPreviews(list: HTMLElement): void {
  for (const item of list.querySelectorAll<HTMLElement>(".workspace-instruction-item")) {
    const isOpen = item.dataset.instructionKey === openWorkspaceInstructionKey;
    item.classList.toggle("expanded", isOpen);
    const header = item.querySelector<HTMLElement>(".workspace-instruction-header.interactive");
    header?.setAttribute("aria-expanded", String(isOpen));
    const preview = item.querySelector<HTMLElement>(".workspace-instruction-preview");
    if (preview) preview.hidden = !isOpen;
  }
}

function renderWorkspaceInstructionStatus(
  status: WorkspaceInstruction["status"],
): HTMLElement {
  const label = instructionStatusLabel(status);
  const wrapper = element("span", {
    className: `workspace-instruction-status ${status}`,
    title: label,
    ariaLabel: label,
  });
  wrapper.setAttribute("role", "img");
  wrapper.append(renderIcon(
    status === "loaded" ? toolIcons.instructionLoaded : toolIcons.instructionAvailable,
    "workspace-instruction-status-svg",
  ));
  return wrapper;
}

function instructionStatusLabel(status: WorkspaceInstruction["status"]): string {
  return status === "loaded"
    ? "Loaded into the current workspace context"
    : "Available for a nested directory";
}

function workspacePathBasename(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

function appendWorkspaceTextRow(
  container: HTMLElement,
  label: string,
  value: string,
  icon: ToolIcon,
  mono = false,
): void {
  const content = element("span", {
    className: `workspace-value${mono ? " mono" : ""}`,
    text: value,
    title: value,
  });
  appendWorkspaceRow(container, label, content, icon);
}

function appendWorkspaceChipRow(
  container: HTMLElement,
  label: string,
  chips: WorkspaceChip[],
  icon: ToolIcon,
): void {
  appendWorkspaceRow(container, label, renderWorkspaceChips(chips), icon);
}

function appendWorkspaceRow(
  container: HTMLElement,
  label: string,
  content: HTMLElement,
  icon: ToolIcon,
  rowClassName?: string,
): void {
  const row = element("div", {
    className: ["workspace-row", rowClassName].filter(Boolean).join(" "),
  });
  row.append(
    renderWorkspaceRowIcon(icon),
    element("span", { className: "workspace-key", text: label }),
    content,
  );
  container.append(row);
}

function appendWorkspaceSkills(
  container: HTMLElement,
  skills: NonNullable<ToolResultCard["skills"]>,
): void {
  const skillChips = skills.map((skill) => ({
    label: skill.name ?? skill.path ?? "Unnamed skill",
    title: [skill.path, skill.description].filter(Boolean).join("\n\n") || undefined,
  }));

  const chipList = renderWorkspaceChips(skillChips);
  chipList.classList.add("workspace-skills-list");
  appendWorkspaceRow(container, "Skills", chipList, toolIcons.skills, "workspace-skills-row");
}

function renderWorkspaceRowIcon(icon: ToolIcon): HTMLElement {
  const wrapper = element("span", {
    className: "workspace-row-icon",
    ariaHidden: "true",
  });
  wrapper.append(renderIcon(icon, "workspace-row-icon-svg"));
  return wrapper;
}

function renderWorkspaceChips(chips: WorkspaceChip[]): HTMLElement {
  const list = element("span", { className: "workspace-chip-list" });
  for (const chip of chips) {
    const bareLogo = Boolean(chip.bareLogo && chip.logo);
    const item = element("span", {
      className: [
        bareLogo
          ? "workspace-provider-logo"
          : chip.profile
          ? "workspace-agent-profile"
          : "workspace-chip",
        chip.tone,
      ].filter(Boolean).join(" "),
      title: chip.title,
    });
    if (bareLogo) {
      item.setAttribute("role", "img");
      item.setAttribute("aria-label", chip.ariaLabel ?? chip.label);
    }
    if (chip.logo) {
      const logo = document.createElement("img");
      logo.className = bareLogo
        ? "workspace-provider-logo-image"
        : chip.profile
        ? "workspace-agent-profile-logo"
        : "workspace-chip-logo";
      logo.src = chip.logo;
      logo.alt = "";
      logo.setAttribute("aria-hidden", "true");
      item.append(logo);
    }
    if (!bareLogo) {
      item.append(element("span", { className: "workspace-chip-label", text: chip.label }));
    }
    list.append(item);
  }
  return list;
}

function toolNameFromMeta(result: CallToolResult): ToolName | undefined {
  const meta = result._meta as Record<string, unknown> | undefined;
  const tool = meta?.tool;
  return isToolName(tool) ? tool : undefined;
}

function cardFromMeta(result: CallToolResult): Partial<ToolResultCard> | undefined {

  const meta = result._meta as Record<string, unknown> | undefined;
  const metaCard = meta?.card;
  return metaCard && typeof metaCard === "object" ? metaCard : undefined;
}

function getStructuredContent<T>(result: CallToolResult): T | undefined {
  return result.structuredContent as T | undefined;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: {
    className?: string;
    text?: string;
    type?: string;
    title?: string;
    ariaHidden?: string;
    ariaLabel?: string;
    ariaExpanded?: string;
    ariaControls?: string;
    ariaBusy?: string;
    ariaLive?: string;
    ariaAtomic?: string;
    role?: string;
    id?: string;
    tabIndex?: number;
    disabled?: boolean;
  } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.id) node.id = options.id;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.type !== undefined && "type" in node) node.setAttribute("type", options.type);
  if (options.title !== undefined) node.title = options.title;
  if (options.ariaHidden !== undefined) node.setAttribute("aria-hidden", options.ariaHidden);
  if (options.ariaLabel !== undefined) node.setAttribute("aria-label", options.ariaLabel);
  if (options.ariaExpanded !== undefined) node.setAttribute("aria-expanded", options.ariaExpanded);
  if (options.ariaControls !== undefined) node.setAttribute("aria-controls", options.ariaControls);
  if (options.ariaBusy !== undefined) node.setAttribute("aria-busy", options.ariaBusy);
  if (options.ariaLive !== undefined) node.setAttribute("aria-live", options.ariaLive);
  if (options.ariaAtomic !== undefined) node.setAttribute("aria-atomic", options.ariaAtomic);
  if (options.role !== undefined) node.setAttribute("role", options.role);
  if (options.tabIndex !== undefined) node.tabIndex = options.tabIndex;
  if (options.disabled !== undefined && "disabled" in node) {
    (node as HTMLButtonElement).disabled = options.disabled;
  }
  return node;
}
