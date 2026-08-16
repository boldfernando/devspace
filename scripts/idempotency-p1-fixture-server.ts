import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import Database from "better-sqlite3";
import { WriteIdempotencyStore } from "../src/idempotency-store.js";

export interface FixtureHandle {
  url: string;
  close(): Promise<void>;
  effectCount(): number;
  effectLogPath: string;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function writeJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

export async function startIdempotencyFixture(root: string): Promise<FixtureHandle> {
  await mkdir(root, { recursive: true });
  const sqlite = new Database(join(root, "fixture.sqlite"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  const store = new WriteIdempotencyStore(sqlite);
  const effectLogPath = join(root, "effects.jsonl");
  let effects = 0;

  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/write") {
        writeJson(response, 404, { error: "not_found" });
        return;
      }
      const scopeKey = request.headers["x-scope-key"];
      const idempotencyKey = request.headers["x-idempotency-key"];
      if (typeof scopeKey !== "string" || typeof idempotencyKey !== "string") {
        writeJson(response, 400, { error: "missing_idempotency_headers" });
        return;
      }
      const input = await readJson(request);
      const simulateTimeout = request.headers["x-simulate-timeout"] === "1";
      const result = await store.run(scopeKey, idempotencyKey, input, async () => {
        effects += 1;
        const path = String(input.path ?? "output.txt");
        const content = String(input.content ?? "");
        await new Promise((resolve) => setTimeout(resolve, Number(input.delayMs ?? 0)));
        await writeFile(join(root, path), content, "utf8");
        await appendFile(effectLogPath, `${JSON.stringify({ scopeKey, idempotencyKey, path })}\n`, "utf8");
        return { path, bytes: Buffer.byteLength(content), effectNumber: effects };
      }, {
        retentionMs: Number(input.retentionMs ?? 60_000),
        pendingLeaseMs: Number(input.pendingLeaseMs ?? 5_000),
      });
      if (simulateTimeout) {
        response.destroy();
        return;
      }
      writeJson(response, result.replayed ? 200 : 201, {
        ok: true,
        replayed: result.replayed,
        value: result.value,
        state: result.record.state,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "IdempotencyConflictError") {
        writeJson(response, 409, { error: "idempotency_conflict" });
        return;
      }
      if (error instanceof Error && error.name === "IdempotencyPendingError") {
        writeJson(response, 409, { error: "idempotency_pending" });
        return;
      }
      writeJson(response, 500, { error: "fixture_error" });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture failed to bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    effectLogPath,
    effectCount: () => effects,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      sqlite.close();
    },
  };
}
