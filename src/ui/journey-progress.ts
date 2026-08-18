import {
  isEditTool,
  isPatchTool,
  isReadTool,
  isReviewTool,
  isSearchTool,
  isShellTool,
  isWriteTool,
  type ToolName,
} from "./card-types.js";

export type JourneyStage = "workspace" | "explore" | "change" | "verify";

export interface JourneyProgress {
  workspace: boolean;
  explore: boolean;
  change: boolean;
  verify: boolean;
}

export interface JourneyProgressUpdate {
  progress: JourneyProgress;
  completedStage?: JourneyStage;
}

export const journeyStages: readonly JourneyStage[] = [
  "workspace",
  "explore",
  "change",
  "verify",
];

export function initialJourneyProgress(): JourneyProgress {
  return {
    workspace: false,
    explore: false,
    change: false,
    verify: false,
  };
}

export function updateJourneyProgress(
  current: JourneyProgress,
  tool: ToolName,
): JourneyProgressUpdate {
  const next = { ...current };
  const stage = stageForTool(tool);
  if (!stage || next[stage]) return { progress: next };

  next[stage] = true;
  return { progress: next, completedStage: stage };
}

export function completedJourneyStages(progress: JourneyProgress): number {
  return journeyStages.reduce(
    (total, stage) => total + (progress[stage] ? 1 : 0),
    0,
  );
}

export function journeyProgressPercent(progress: JourneyProgress): number {
  return Math.round((completedJourneyStages(progress) / journeyStages.length) * 100);
}

export function nextJourneyStep(progress: JourneyProgress): string {
  if (!progress.workspace) return "Open a workspace to begin.";
  if (!progress.explore) return "Explore files or search the workspace for context.";
  if (!progress.change) return "Make a change or review the current diff.";
  if (!progress.verify) return "Run a verification command before you finish.";
  return "Workflow milestone complete. Keep going when you are ready.";
}

export function journeyStageLabel(stage: JourneyStage): string {
  switch (stage) {
    case "workspace":
      return "Workspace ready";
    case "explore":
      return "Context explored";
    case "change":
      return "Change made or reviewed";
    case "verify":
      return "Result verified";
  }
}

function stageForTool(tool: ToolName): JourneyStage | undefined {
  if (tool === "open_workspace") return "workspace";
  if (isReadTool(tool) || isSearchTool(tool) || tool === "ls") return "explore";
  if (isEditTool(tool) || isWriteTool(tool) || isPatchTool(tool) || isReviewTool(tool)) {
    return "change";
  }
  if (isShellTool(tool)) return "verify";
  return undefined;
}
