import assert from "node:assert/strict";
import test from "node:test";
import { buildDevServerCommand } from "./dev-command.mjs";

test("the dev server launches tsx through Node without a shell", () => {
  const execPath = "C:\\Program Files\\nodejs\\node.exe";

  const launch = buildDevServerCommand(execPath);

  assert.equal(launch.command, execPath);
  assert.deepEqual(launch.args, ["--import", "tsx", "src/cli.ts", "serve"]);
  assert.equal("shell" in launch, false);
});
