# Canonical Platform Review 360 v3.0.0 — Prioritized Roadmap

## Decision context

The exact evaluated baseline is commit `02d99a2f9c0dc560a23bcf6e89946cd0d45d9a88` on branch `main`, with a dirty working tree that was preserved. The platform is **not release-ready** because the release/rollback gate is RED even though the local critical application gates are green. The roadmap therefore starts with proof of the release boundary, not with speculative product refactoring.

## Horizon 0 — Release-blocking proof, P1

| ID | Work package | Owner | Dependencies | Acceptance criteria | Evidence and rollback |
|---|---|---|---|---|---|
| PR-001 | Establish a staging/deployment target, build-once promotion, immutable artifact digest, post-deploy smoke, rollback, and restore drill. | Platform/SRE + Release Authority | CI workflow and environment contract | A commit SHA maps to one promoted artifact digest; SBOM/attestation verifies; `/readyz`, OAuth/MCP smoke, and rollback/reversal exit 0; restore evidence is retained. | Evidence: `platform-review-gate-matrix.json`, `.github/workflows/ci.yml`. Roll back to the previous signed digest; never reset the source checkout. |
| PR-002 | Prove the production-like identity gateway, explicit RBAC, key rotation, and cross-tenant policy. | IAM/Security | Authorized staging identity provider and test principals | Actor × Resource × Action × Context matrix passes; rotated old key is rejected; role/tenant denials are fail-closed; revocation and subject transfer remain denied. | Evidence: `review-auth-iam.log`, `artifacts/block1-identity-report.json`. Use dual-key overlap and reversible identity configuration. |
| PR-003 | Connect hosted Prometheus/Grafana and execute alert firing/recovery. | SRE/Operations | Staging target and notification channel | Synthetic auth-denial, server-error, latency, readiness, and idempotency ambiguity signals fire, notify, recover, and produce a sanitized incident record. | Evidence: `review-observability-sre.log`, local dashboard/alert files. Revert alert/dashboard version or expire a single failing rule with owner approval. |

## Horizon 1 — Security and release hardening, P2

| ID | Work package | Owner | Dependencies | Acceptance criteria | Evidence and rollback |
|---|---|---|---|---|---|
| PR-004 | Stabilize the isolated real-server security probe bootstrap and rerun CSRF/XSS/SQLi cases. | AppSec + E2E Infrastructure | Deterministic Windows process startup and health readiness | Probe server binds, all cases execute against the real server, rejected requests have no side effects, secret scan passes, and cleanup is proven. | Evidence: `artifacts/security-audit/10-probe-diagnosis.log`. No product rollback; clean only isolated test resources. |
| PR-005 | Add CycloneDX/SPDX SBOM and signed SLSA-compatible provenance verification to CI. | Supply Chain/Release | Deployment artifact target | SBOM validates and matches the lockfile; attestation verifies commit/artifact digest; missing provenance blocks promotion. | Evidence: `GITHUB-INTELLIGENCE.json`. Retain the last signed release and block unproven artifacts. |
| PR-006 | Expand or risk-justify cross-OS chaos/Swarm and add authorized browser-host E2E. | QA/Client Integration | Stable host/browser harness and OS runners | Supported OS jobs and browser-host flows exit 0; screenshots/interaction traces are supplemental to assertions; no orphan process/session/resource remains. | Evidence: `.github/workflows/ci.yml`, `evidence/raw/test-strategy-report.json`. Quarantine environment failures without weakening product gates. |

## Horizon 2 — Resilience and performance, P3

| ID | Work package | Owner | Dependencies | Acceptance criteria | Evidence and rollback |
|---|---|---|---|---|---|
| PR-007 | Close the write-to-ACK ambiguity gap for non-reversible process/stdin effects with durable ACK, fencing, and reconciliation. | Runtime/Resilience | Process-instance and stdin-delivery protocol | Crash between effect and ACK yields explicit ambiguous state; zombies are fenced; retries do not duplicate effects; reconciliation is auditable. | Evidence: `review-idempotency.log`, `artifacts/write-stdin-idempotency-report.json`. Never auto-replay uncertain non-reversible input. |
| PR-008 | Calibrate hosted load by region/tool and external provider/runtime behavior. | Performance/SRE | Hosted staging target and safe synthetic fixtures | Three runs per region/tool establish p50/p95/p99, throughput, 429/5xx, timeout, retry, and saturation thresholds; thresholds are not promoted without variance evidence. | Evidence: `artifacts/wave3-performance/summary.json`, `artifacts/mcp-load-log.json`. Stop load and preserve prior thresholds if calibration is unstable. |

## Horizon 3 — Strategic automation, P4

| ID | Work package | Owner | Dependencies | Acceptance criteria | Evidence and rollback |
|---|---|---|---|---|---|
| PR-009 | Codify enterprise RBAC policy, dual-key rotation, provenance automation, and evidence retention. | Security Platform | P1/P2 identity and supply-chain proof | Policy, rotation, SBOM, attestation, and retention tests pass in CI with versioned rollback paths. | Evidence: `review-auth-iam.log`, `GITHUB-INTELLIGENCE.json`. Retain previous policy/key/workflow versions. |

## Sequencing rule

Do not close a lower-priority item by inference from a higher-priority local pass. **G9 remains RED until deployment, promotion, rollback, and restore are executed.** Historical failed aggregate artifacts remain preserved; they must be reconciled by a new authoritative run or explicitly superseded with provenance, not deleted.
