import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "./config.js";
import { createReviewCheckpointManager } from "./review-checkpoints.js";
import { ProcessSessionManager } from "./process-sessions.js";
import { createMcpServer } from "./server.js";
import { SqliteWorkspaceStore } from "./workspace-store.js";
import { WorkspaceRegistry } from "./workspaces.js";

async function fixture(t: import("node:test").TestContext, widgets: string) {
  const root = await mkdtemp(join(tmpdir(), "devspace-render-ui-"));
  const project = join(root, "project");
  await mkdir(project, { recursive: true });
  await writeFile(join(project, "README.md"), "hi\n");
  const config = loadConfig({
    DEVSPACE_CONFIG_DIR: join(root, ".config"),
    DEVSPACE_ALLOWED_ROOTS: root,
    DEVSPACE_STATE_DIR: join(root, ".state"),
    DEVSPACE_WORKTREE_ROOT: join(root, ".worktrees"),
    DEVSPACE_AGENT_DIR: join(root, ".agents"),
    DEVSPACE_WIDGETS: widgets,
    DEVSPACE_OAUTH_OWNER_TOKEN: "render-ui-owner-token-0123456789",
    PORT: "1",
  });
  const store = new SqliteWorkspaceStore(join(root, ".state"));
  const server = createMcpServer(config, new WorkspaceRegistry(config, store), createReviewCheckpointManager(), new ProcessSessionManager(), [], []);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "render-ui-test", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  t.after(async () => {
    await client.close();
    await server.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { client, config };
}

const spec = {
  root: "card",
  elements: {
    card: { type: "Card", props: { title: "Suite status", description: null, maxWidth: null, centered: null, className: null }, children: ["s"] },
    s: { type: "Stack", props: { direction: "vertical", gap: "md", align: null, justify: null, className: null }, children: ["h", "t"] },
    h: { type: "Heading", props: { text: "Suite status", level: "h2" }, children: [] },
    t: { type: "Table", props: { columns: ["Suite", "Result"], rows: [["config", "pass"]], caption: null }, children: [] },
  },
};

test("render_ui renders a valid spec and exposes the UI resource", async (t) => {
  const { client } = await fixture(t, "full");

  const tools = await client.listTools();
  const renderTool = tools.tools.find((tool) => tool.name === "render_ui");
  assert.ok(renderTool, "render_ui must be registered");
  console.log("render_ui annotations:", JSON.stringify(renderTool.annotations));
  console.log("render_ui ui meta:", JSON.stringify((renderTool._meta as { ui?: unknown })?.ui));

  const resources = await client.listResources();
  const uiResource = resources.resources.find((entry) => entry.uri === "ui://devspace/json-render-app.html");
  assert.ok(uiResource, "json-render app resource must be listed");

  const read = await client.readResource({ uri: "ui://devspace/json-render-app.html" });
  const html = (read.contents[0] as { text: string }).text;
  console.log("resource html length:", html.length);
  assert.match(html, /json-render-app-[A-Za-z0-9_-]+\.js/);
  assert.match(html, /mcp-app-assets/);
  console.log("resource csp:", JSON.stringify((read.contents[0]._meta as { ui?: { csp?: unknown } })?.ui?.csp));

  const ok = await client.callTool({ name: "render_ui", arguments: { spec, title: "Test suite" } });
  console.log("valid spec ->", JSON.stringify(ok.structuredContent), "isError:", ok.isError === true);
  assert.equal(ok.isError, undefined);
  assert.deepEqual(ok.structuredContent, { rendered: true, elementCount: 4, title: "Test suite" });
  const meta = ok._meta as { jsonRender?: { title?: string; spec?: unknown } };
  assert.ok(meta.jsonRender?.spec, "spec must reach the UI through _meta");
  assert.equal(meta.jsonRender.title, "Test suite");

  const bad = await client.callTool({
    name: "render_ui",
    arguments: { spec: { root: "x", elements: { x: { type: "ScriptTag", props: { src: "https://evil.example/x.js" }, children: [] } } } },
  });
  const badText = (bad.content as { type: string; text: string }[])[0]?.text ?? "";
  console.log("invalid spec ->", "isError:", bad.isError, "|", badText.split("\n")[0]);
  assert.equal(bad.isError, true);
  assert.match(badText, /INVALID_UI_SPEC/);
  assert.equal((bad._meta as { jsonRender?: unknown } | undefined)?.jsonRender, undefined, "rejected spec must not reach the UI");

  const badProps = await client.callTool({
    name: "render_ui",
    arguments: { spec: { root: "t", elements: { t: { type: "Table", props: { columns: "Suite", rows: [], caption: null }, children: [] } } } },
  });
  console.log("bad props ->", "isError:", badProps.isError);
  assert.equal(badProps.isError, true);
});

test("render_ui is absent when widgets are off", async (t) => {
  const { client } = await fixture(t, "off");
  const tools = await client.listTools();
  assert.equal(tools.tools.some((tool) => tool.name === "render_ui"), false);
  const resources = await client.listResources();
  assert.equal(resources.resources.some((entry) => entry.uri === "ui://devspace/json-render-app.html"), false);
  console.log("widgets=off -> render_ui and resource not exposed");
});
