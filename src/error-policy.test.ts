import assert from "node:assert/strict";
import test from "node:test";
import { classifyError, safeToolErrorContent } from "./error-policy.js";

test("classifies filesystem failures without exposing the original path", () => {
  const error = new Error("EACCES: permission denied, open C:\\private\\secret.txt");
  const descriptor = classifyError(error);

  assert.equal(descriptor.code, "FILESYSTEM_PERMISSION_DENIED");
  assert.equal(descriptor.category, "filesystem");
  assert.equal(descriptor.retryable, false);
  assert.doesNotMatch(safeToolErrorContent(error), /private|secret\.txt|EACCES/);
});

test("classifies retryable SQLite contention and timeout failures", () => {
  assert.deepEqual(classifyError(new Error("SQLITE_BUSY: database is locked")), {
    code: "DATABASE_BUSY",
    category: "resource",
    retryable: true,
    userMessage: "The database is busy. Retry the operation.",
  });
  assert.equal(classifyError(new Error("upstream request timed out")).code, "REQUEST_TIMEOUT");
  assert.equal(classifyError(new Error("upstream request timed out")).retryable, true);
});

test("preserves safe process and domain codes while replacing raw detail", () => {
  const descriptor = classifyError(Object.assign(new Error("native spawn detail"), {
    code: "PROCESS_START_FAILED",
  }));

  assert.equal(descriptor.code, "PROCESS_START_FAILED");
  assert.equal(safeToolErrorContent(Object.assign(new Error("native spawn detail"), {
    code: "PROCESS_START_FAILED",
  })), "PROCESS_START_FAILED: The process could not be started.");
  assert.equal(
    classifyError("PROCESS_START_FAILED: The process could not be started.").code,
    "PROCESS_START_FAILED",
  );
});
