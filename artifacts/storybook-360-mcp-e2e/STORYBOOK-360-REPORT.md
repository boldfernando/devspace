# Storybook 360 MCP — AS IS → TO BE Report

**Mission:** Integrate `storybook-360-mcp` into the real DevSpace repository with an evidence-first Atomic Design audit, Component↔Story↔Unit↔Integration↔E2E↔Mock reconciliation, deterministic mocks, and a reproducible gate chain.

**Baseline:** `7478d538815d5cec2596ad2101a753ebb96e0165`
**Current implementation:** browser-host slice in the dirty worktree after `c7fe916`
**Execution environment:** Node `v24.18.0`, Windows `win32`
**Decision:** **Local implementation GREEN; browser-host gates GREEN; coverage reconciliation YELLOW; global status YELLOW; release status NOT RELEASE-READY.**

> The local Storybook surface is now proven in Chromium: all seven stories passed, both interaction paths passed, all seven axe scans passed, and all seven visual snapshots compared successfully. Cross-OS execution, production MCP host-context lifecycle, and hosted deployment/rollback remain outside this proof boundary and are not inferred as passed.

## Executive summary

The repository started with no Storybook installation, no stories, no Atomic Design directories, no MSW/AIMock layer, no Storybook scripts, and no lint gate. The existing UI is a single-shell React/TypeScript surface under `src/ui`, with shared CSS tokens, lazy payload renderers, source-level accessibility contracts, and unit tests. The integration preserved that architecture rather than creating artificial `atoms`, `molecules`, `organisms`, `templates`, or `pages` folders.

The target now includes Storybook `10.5.9`, `@storybook/addon-mcp`, `@storybook/addon-a11y`, MSW `2.15.0`, `msw-storybook-addon`, ESLint 10, Playwright Chromium, `@axe-core/playwright`, a generated service worker, seven versioned fixtures, seven stories, two interaction play functions, a typed deterministic model with streaming and tool-calling, MSW handlers, four Mock Layer contract tests, strict lint, browser-host interaction/a11y/visual tests, versioned visual baselines, and preserved pass screenshots/videos. The browser-aware chain passed lint, typecheck, production build, Storybook build/contracts/browser checks, unit/integration tests, coverage, observability, strategy audit, security P0, real HTTP/MCP E2E, and doctor.

The first browser run exposed a real WCAG contrast defect: `.tool-label` and `.header-meta` rendered `#a3a3aa` on `#414141` at 4.07:1, below the 4.5:1 WCAG AA threshold. The production CSS was repaired to use the secondary text token `#c7c7ce`, a source-level regression contract was added, and the subsequent seven-story axe run passed with zero violations. This is a demonstrated repair, not a waived finding.

## 1. AS IS → TO BE

| Domain | AS IS | TO BE implemented | Status |
|---|---|---|---|
| Storybook runtime | No dependency, config, script, or story | Storybook 10.5.9 with Vite React integration and build/smoke/check scripts | GREEN |
| Storybook MCP | No addon or MCP-specific surface | `@storybook/addon-mcp@0.7.0` configured in `.storybook/main.ts` | GREEN |
| Accessibility | Source contracts existed, but browser execution was absent | Addon-a11y plus Playwright axe scans for all seven stories; contrast defect repaired | GREEN |
| Mock Layer | No tracked MSW, AIMock, or Storybook provider mock | Typed deterministic model, adapters, MSW handlers, fail-closed missing scenarios, no provider fallback | GREEN |
| Fixtures | One unrelated idempotency fixture server; no Storybook fixtures | Seven versioned fixtures covering success/error/empty/loading/timeout/retry/streaming/tool-calling | GREEN |
| Stories | Zero stories | Seven `ToolResultCard` stories; two interaction play functions; all run in Chromium | GREEN |
| Atomic Design | No atoms/molecules/organisms/templates/pages directories | Real shared-shell architecture preserved; no artificial taxonomy created | YELLOW / intentional adaptation |
| Unit contracts | Existing source-level UI tests | Existing tests preserved and four Mock Layer contract tests added | GREEN |
| Integration | No Storybook integration gate | `storybook:check:browser` builds Storybook, runs four contracts, then browser tests | GREEN |
| Browser E2E | No browser-host Storybook runner | Playwright Chromium runs all seven stories and both interaction paths | GREEN locally |
| Visual regression | No screenshot baseline/diff service | Seven Playwright baselines plus pass screenshot/video evidence and SHA-256 manifest | GREEN locally |
| Lint | Script absent; legacy warnings/errors surfaced during integration | ESLint strict zero-warning gate; all observed issues repaired | GREEN |

## 2. Component↔Story↔Unit↔Integration↔E2E↔Mock reconciliation

The full JSON ledger is the source of truth. The matrix below distinguishes direct browser proof from indirect source-contract coverage and preserves the production MCP host bridge boundary.

| Component / surface | Story | Unit | Integration | E2E | Mock |
|---|---|---|---|---|---|
| `workspace-app.tsx` + `workspace-app.css` | Indirect shared shell in fixture harness | Accessibility, render strategy, sync-state contracts | Storybook build/contracts/browser | Browser-host mount, axe, and visual snapshot pass; production MCP host bridge not exercised | Deterministic model + MSW + seven fixtures |
| `card-types.ts` + `card-result-normalizer.ts` | All seven stories consume real type and payload shapes | Dedicated card and normalizer tests | Mock contract suite passes | Browser-host fixture execution passes | All seven fixtures |
| `tool-display.ts` | All seven stories call the real display classifier | Dedicated tool-display tests | Storybook build passes | Browser-host fixture execution passes | All seven fixtures |
| `heavy-payload.tsx` | Indirect read/write/status representation | Accessibility and render-strategy contracts | Typecheck/build pass | Partial: shell browser proof passes; direct lazy-renderer assertion remains absent | Read/write/timeout/streaming fixtures |
| `file-payload.tsx`, `diff-payload.tsx`, `review-payload.tsx` | Indirect payload representation; no direct renderer story | Accessibility and patch contracts | Build and source tests pass | Partial: fixture browser proof passes; direct code/diff renderer story remains absent | Read/write/retry/streaming fixtures |
| `patch-display.ts` | Indirect write/retry payloads | Dedicated patch-display tests | `npm test` passes | Partial: retry interaction passes; direct diff interaction remains absent | Write-error and retry fixtures |
| `journey-progress.ts` | No direct story | Dedicated journey tests | `npm test` passes | Unknown: journey trace is not represented by the seven-story harness | No dedicated journey scenario |
| `sync-state.ts` | No direct story | Dedicated sync-state tests | `npm test` passes | Unknown: reconnect/epoch browser test remains absent | No dedicated Storybook scenario |
| `language-catalog.ts` | Indirect real file paths | Dedicated language tests | Build/tests pass | Partial: file-path fixture browser proof passes; language-specific render assertion remains absent | Read and streaming fixtures |
| `icons.ts`, `scrollbar.ts`, `vite-env.d.ts` | No direct story | CSS contract covers relevant style behavior; no dedicated icon/scrollbar unit suite | Storybook build passes | Pass for seven harness snapshots; not a complete infrastructure-only visual suite | Not applicable |

The absence of a direct story is not automatically a defect because the repository does not expose every file as an independent component. Existing source contracts remain the unit layer; stories target the user-visible tool-result surface; the deterministic Mock Layer owns external behavior. Direct renderer stories remain a targeted follow-up only where they add distinct interaction or visual value.

## 3. Mock Layer design and proof

The Mock Layer is isolated under `storybook-360-mcp/mocks/` and uses typed `MockState`, `MockScenario`, streaming chunks, tool calls, and adapter interfaces. `DeterministicMockModel` resolves scenarios by ID, emits stable ordered events, returns explicit error events for missing scenarios, and never falls back to a live provider. `MockLanguageModelAdapter` provides an interchangeable AI SDK-style boundary. MSW handlers expose only the deterministic scenario endpoint.

The seven fixtures cover `success`, `error`, `empty`, `loading`, `timeout`, and `retry`, with tool-calling and streaming states. Four contract tests prove catalog state coverage, deterministic replay, injected adapter behavior, streaming/tool-calling emission, and fail-closed behavior for a missing scenario. Evidence: `storybook-360-mcp/tests/mock-layer.test.ts` and `10-storybook-browser-check.stdout.log`.

## 4. Browser-host proof and repair history

The browser gate is configured in `playwright.config.ts` and runs Storybook through `webServer` at `http://127.0.0.1:6006`. `ToolResultCard.browser.spec.ts` navigates to the authoritative Storybook story IDs, executes the retry/tool-calling and streaming interactions, runs `AxeBuilder` with `wcag2a` and `wcag2aa`, and compares seven deterministic screenshot baselines. `STORYBOOK_BROWSER_MEDIA=1` preserves pass screenshots and videos for evidence.

The first run failed the accessibility oracle with `color-contrast`: foreground `#a3a3aa`, background `#414141`, ratio `4.07`, expected `4.5`. The repair changed `.tool-label` and `.header-meta` in `src/ui/workspace-app.css` to `var(--color-text-secondary, #c7c7ce)` and added explicit source assertions in `src/ui/accessibility-contract.test.ts`. The second browser execution reported zero axe violations; after correcting the unique screenshot target from `.shell` to `main.shell`, baseline generation and the normal visual comparison both passed seven of seven.

Evidence for this sequence is preserved in `09-browser-host-report.json`, `09-browser-host-visual-findings.md`, `09-browser-media/`, `storybook-360-mcp/visual-baselines/`, and `10-browser360-media-manifest.sha256`.

## 5. Gate execution

The browser-aware chain was executed in series by `artifacts/storybook-360-mcp-e2e/10-run-browser360-gates.mjs`. Each stdout/stderr stream was captured byte-exactly and hashed in `10-browser360-gate-summary.json`.

| Gate | Command | Result | Duration |
|---|---|---:|---:|
| Lint | `npm run lint` | GREEN, exit 0 | 2.101 s |
| Typecheck | `npm run typecheck` | GREEN, exit 0 | 3.573 s |
| Production build | `npm run build` | GREEN, exit 0; existing chunk warning | 4.481 s |
| Storybook build/contracts/browser | `npm run storybook:check:browser` | GREEN, exit 0; 4/4 contracts; 7/7 browser | 20.035 s |
| Unit/integration | `npm test` | GREEN, exit 0 | 42.072 s |
| Coverage thresholds | `npm run coverage:check` | GREEN, exit 0 | 55.379 s |
| Observability contract | `npm run test:observability` | GREEN, exit 0 | 0.377 s |
| Strategy audit | `npm run test:strategy:audit` | GREEN, exit 0 | 0.426 s |
| Security P0 | `npm run security:p0` | GREEN, exit 0; 23/23; no secret leak | 3.947 s |
| Real HTTP/MCP E2E | `npm run e2e` | GREEN, exit 0 | 7.549 s |
| Doctor | `npm run doctor` | GREEN, exit 0 | 2.099 s |

Coverage output remains **67.97% statements/lines, 80.31% branches, and 71.31% functions**, above configured thresholds of 60/45/55/60. The security matrix observed all 23 required scenarios with `missing_scenarios=[]` and `secret_leak_detected=false`.

## 6. Findings and residual boundaries

### Closed — browser interaction, a11y, and visual regression for the harness

The seven-story Storybook harness now has executable Chromium proof. The two interaction paths, seven axe scans, seven screenshot comparisons, pass media, and raw JSON report are all present. The initial contrast defect was fixed rather than suppressed.

### P2 — Atomic Design taxonomy is absent by design

The real UI is a single shell, not a component library with folder-level Atomic Design boundaries. Creating empty taxonomy folders would create drift and duplication. Keep the current decision unless product architecture explicitly introduces reusable atoms/molecules; if that happens, refactor production components first and then add stories and unit contracts from those boundaries.

### P2 — Indirect story coverage for payload infrastructure

Several production modules have strong source contracts but no direct story. Add direct stories only for a distinct user-facing interaction or visual state that cannot be proven through the existing shell stories and source contracts. Do not create stories solely to increase counts.

### P2 — Existing chunk-size warning remains

Production and Storybook builds still report a post-minification chunk above 500 kB. Analyze the Storybook iframe and production bundle separately, preserve existing lazy boundaries, and split only after a measured dependency graph identifies a safe cut.

### P2 — Cross-OS and host-context boundary remains

The browser proof is Windows-local Chromium against Storybook's fixture harness. Cross-OS browser runs, the production MCP host bridge, real host-context lifecycle, hosted deployment, rollback, and release packaging remain outside this cycle's executable proof boundary.

## 7. DoR / DoD decision

| Checklist | Decision | Evidence |
|---|---|---|
| Scope and baseline identified | READY | `04-discovery-versioned.json`, baseline SHA |
| Architecture and conventions inspected | DONE | `src/ui/workspace-app.css`, UI contract tests, existing source layout |
| Mock and fixture contract defined | DONE | `storybook-360-mcp/mocks/`, `fixtures/`, four contract tests |
| Executable local and browser gates | DONE | `10-browser360-gate-summary.json`, all 11 commands exit 0; 7/7 browser stories pass |
| Browser-host interaction/a11y | DONE for local harness | `09-browser-host-report.json`, axe attachments, pass media |
| Visual regression | DONE for local harness | seven baselines, seven comparisons, SHA-256 media manifest |
| Security and secret scan | DONE locally | `security:p0`, 23/23 and `secret_leak_detected=false` |
| Cross-OS / hosted deployment / rollback | PARTIAL | Outside this local proof boundary |
| Production MCP host-context lifecycle | PARTIAL | Fixture harness does not replace real host integration |

**DoD classification:** **DONE for the implemented local Storybook/Mock/browser slice; PARTIAL globally.** No full `RELEASE-READY` claim is made for the complete 360-degree deployment and cross-platform quality gate.

## 8. Evidence index

- `STORYBOOK-360-EVIDENCE-LEDGER.json` — structured inventory, matrix, decisions, gaps, and gate outcomes.
- `10-run-browser360-gates.mjs` — reproducible serial runner for the browser-aware chain.
- `10-browser360-gate-summary.json` — commands, exit codes, timings, browser proof, and SHA-256 evidence pointers.
- `10-*.stdout.log` / `10-*.stderr.log` — byte-exact raw command evidence; no failed or intermediate output was deleted.
- `09-browser-host-report.json` — Playwright JSON report with seven browser tests and axe attachments.
- `09-browser-host-visual-findings.md` — first-failure diagnosis and contrast repair record.
- `09-browser-media/` — seven pass screenshots and seven pass videos.
- `storybook-360-mcp/visual-baselines/` — seven versioned visual baselines.
- `10-browser360-media-manifest.sha256` — SHA-256 manifest for baselines and preserved media.
- `storybook-360-mcp/mocks/` — typed deterministic Mock Layer.
- `storybook-360-mcp/fixtures/tool-results.ts` — seven versioned fixture scenarios.
- `storybook-360-mcp/stories/ToolResultCard.stories.tsx` — seven stories and two play functions.
- `storybook-360-mcp/tests/mock-layer.test.ts` — four contract tests.

## Final decision

**Local implementation:** GREEN.
**Browser-host Storybook/a11y/visual harness:** GREEN.
**Coverage reconciliation:** YELLOW because direct renderer, journey, reconnect, cross-OS, and production host-context proof remains incomplete.
**Global E2E 360 status:** YELLOW.
**Release:** **NOT RELEASE-READY** until inherited cross-platform, host-context, deployment, rollback, and bundle-performance blockers are closed with executable evidence.
