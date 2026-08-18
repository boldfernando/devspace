import assert from "node:assert/strict";
import test from "node:test";
import {
  beginConnection,
  beginRender,
  initialUiSyncState,
  isCurrentConnection,
  isCurrentRender,
} from "./sync-state.js";

test("connection epochs invalidate an older boot attempt", () => {
  const first = beginConnection(initialUiSyncState);
  const second = beginConnection(first.state);

  assert.equal(isCurrentConnection(second.state, first.value), false);
  assert.equal(isCurrentConnection(second.state, second.value), true);
  assert.equal(second.state.renderRevision > first.state.renderRevision, true);
});

test("render revisions invalidate a lazy result from a previous shell", () => {
  const first = beginRender(initialUiSyncState);
  const second = beginRender(first.state);

  assert.equal(isCurrentRender(second.state, first.revision), false);
  assert.equal(isCurrentRender(second.state, second.revision), true);
});

test("starting a connection also invalidates pending renders", () => {
  const render = beginRender(initialUiSyncState);
  const reconnect = beginConnection(render.state);

  assert.equal(isCurrentRender(reconnect.state, render.revision), false);
  assert.equal(isCurrentConnection(reconnect.state, reconnect.value), true);
});
