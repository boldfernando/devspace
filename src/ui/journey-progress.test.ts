import assert from "node:assert/strict";
import test from "node:test";
import {
  completedJourneyStages,
  initialJourneyProgress,
  journeyProgressPercent,
  nextJourneyStep,
  updateJourneyProgress,
} from "./journey-progress.js";

test("journey progress advances through workspace, explore, change, and verify", () => {
  let progress = initialJourneyProgress();

  const workspace = updateJourneyProgress(progress, "open_workspace");
  progress = workspace.progress;
  assert.equal(workspace.completedStage, "workspace");

  const explore = updateJourneyProgress(progress, "read");
  progress = explore.progress;
  assert.equal(explore.completedStage, "explore");

  const change = updateJourneyProgress(progress, "edit");
  progress = change.progress;
  assert.equal(change.completedStage, "change");

  const verify = updateJourneyProgress(progress, "exec_command");
  progress = verify.progress;
  assert.equal(verify.completedStage, "verify");
  assert.equal(completedJourneyStages(progress), 4);
  assert.equal(journeyProgressPercent(progress), 100);
  assert.equal(nextJourneyStep(progress), "Workflow milestone complete. Keep going when you are ready.");
});

test("repeated tools do not retrigger a completed milestone", () => {
  const first = updateJourneyProgress(initialJourneyProgress(), "open_workspace");
  const repeated = updateJourneyProgress(first.progress, "open_workspace");

  assert.equal(repeated.completedStage, undefined);
  assert.equal(completedJourneyStages(repeated.progress), 1);
  assert.equal(nextJourneyStep(repeated.progress), "Explore files or search the workspace for context.");
});

test("interactive process input only completes the verification stage", () => {
  const initial = initialJourneyProgress();
  const update = updateJourneyProgress(initial, "write_stdin");

  assert.equal(update.completedStage, "verify");
  assert.equal(completedJourneyStages(update.progress), 1);
  assert.equal(update.progress.workspace, false);
  assert.equal(update.progress.explore, false);
  assert.equal(update.progress.change, false);
  assert.equal(update.progress.verify, true);
  assert.equal(nextJourneyStep(update.progress), "Open a workspace to begin.");
});
