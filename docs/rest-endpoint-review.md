# DevSpace REST Endpoint Review

**Review date:** 2026-08-18
**Reference commit:** `d8942c9`
**Scope:** Express route surface surrounding OAuth discovery, revocation, health, metrics, static assets, and the authenticated MCP transport.

## Executive assessment

The current HTTP surface is intentionally small and compatible with the existing MCP/OAuth clients. The routes use resource-oriented paths for OAuth metadata and token revocation, expose operational health and metrics separately, and keep MCP JSON-RPC on `/mcp`. No breaking REST redesign is required for the current product boundary. The main follow-up work is operational: protect or isolate metrics according to deployment policy, document cache and authentication expectations for discovery/static assets, and add contract coverage for status/error semantics as the surface evolves.

## Current route matrix

| Route | Method | Purpose | Authentication | Current response contract | Review decision |
|---|---|---|---|---|---|
| `/.well-known/oauth-authorization-server` | GET | OAuth metadata discovery | Public | JSON metadata advertises issuer, authorization, token, revocation, registration, device authorization, grants, scopes, and S256 | Keep; standard discovery path and no breaking change. |
| `/register` | OAuth provider route | Dynamic client registration | Provider-managed | OAuth registration contract | Keep provider-managed; test through OAuth E2E. |
| `/authorize` | OAuth provider route | Authorization-code authorization | OAuth flow | Provider-managed redirect/authorization contract | Keep; no parallel custom route. |
| `/token` | OAuth provider route | Authorization-code, refresh-token, and device-code exchange | OAuth flow | Provider-managed token/error contract | Keep; preserve PKCE/device compatibility. |
| `/oauth/device/authorize` | POST/provider route | Device Authorization Grant request | OAuth client validation/rate limits | Device code response or RFC 8628 error | Keep; retain sanitized polling errors and rate limits. |
| `/oauth/device/verify` and approval routes | Provider-managed | Device verification and approval/denial | Configured approval mode | HTML/JSON provider contract | Keep; real identity gateway remains a separate P1 gap. |
| `/revoke` | POST | Revoke access or refresh token | Client/token body validation | `200` with empty JSON body; invalid or unknown token is intentionally idempotent | Keep current compatibility behavior; consider explicit content-type contract tests before any change. |
| `/mcp` | GET/POST/DELETE/OPTIONS via `app.all` | Streamable HTTP MCP transport | Bearer/resource/scope/session checks | MCP JSON-RPC, streaming, lifecycle, or fail-closed HTTP errors | Keep single transport endpoint; tool authorization stays in MCP policy. |
| `/mcp-app-assets/{*asset}` | OPTIONS | CORS/preflight for widget assets | Public | `204` with asset headers | Keep; maintain cache/header contract. |
| `/mcp-app-assets/*` | GET/static | Serve built widget assets | Public | Immutable static content, one-year cache policy | Keep; asset build remains separate from API behavior. |
| `/metrics` | GET | Prometheus exposition | Deployment-dependent | `text/plain; version=0.0.4` | Keep; operational access control/scrape policy is P1-OBS-002. |
| `/healthz` | GET | Liveness check | Public/local | `{ "ok": true, "name": "devspace" }` | Keep; readiness/dependency checks are a separate operational decision. |

## Findings and recommendations

The route methods and paths are consistent with the existing clients and OAuth discovery expectations. The `/mcp` endpoint is a protocol endpoint rather than a conventional CRUD resource, so forcing REST verbs or splitting it into tool-specific paths would reduce compatibility without improving the current contract.

The revocation handler returns an empty successful response even when the submitted token or client is not actionable. This is compatible with privacy-preserving revocation semantics and should not be changed without a versioned client contract. A future improvement may add explicit contract tests for malformed bodies and content type while retaining the same status behavior.

The health endpoint is a liveness signal, not proof that SQLite, filesystem roots, child processes, or OAuth dependencies are ready. The resilience backlog must therefore keep P2-RES-002 and hosted operational alerting open rather than treating `/healthz` as a full readiness gate.

The metrics endpoint exposes sanitized Prometheus data locally, while production exposure, scrape authentication, alert firing, and recovery remain unverified. Those are tracked by `P1-OBS-002`; this document does not claim hosted readiness.

## Evidence and compatibility gates

The implementation-side API refactor is covered by `src/mcp-request-policy.test.ts`, the existing MCP negative matrix, `npm test`, `npm run typecheck`, and `npm run build`. The review itself introduces no route, status-code, request-body, or command breaking change. Any future route change must update OAuth discovery, MCP negative tests, the route matrix, and the sanitized evidence index together.

## Backlog mapping

| Follow-up | Status | Owner evidence |
|---|---|---|
| MCP scope classification and process registration structure | Complete locally | `src/mcp-request-policy.ts`, `src/server.ts`, `src/mcp-request-policy.test.ts` |
| Full REST route redesign | Not required | Compatibility review above; avoid speculative breaking changes. |
| Operational metrics access and alert firing | Partial / UNKNOWN hosted | `P1-OBS-002`, `observability/`, `artifacts/observability-contract-report.json` |
| Dependency-aware readiness and failure behavior | Backlog | `P2-RES-002`, process/filesystem/SQLite resilience evidence to be added. |
