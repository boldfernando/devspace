import { defineConfig, devices } from "@playwright/test";

const preserveMedia = process.env.STORYBOOK_BROWSER_MEDIA === "1";

export default defineConfig({
  testDir: "./storybook-360-mcp/tests",
  testMatch: "**/*.browser.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      maxDiffPixelRatio: 0.01,
    },
  },
  reporter: [
    ["line"],
    ["json", { outputFile: "artifacts/storybook-360-mcp-e2e/09-browser-host-report.json" }],
  ],
  snapshotPathTemplate: "{testDir}/../visual-baselines/{arg}{ext}",
  use: {
    baseURL: "http://127.0.0.1:6006",
    trace: "retain-on-failure",
    screenshot: preserveMedia ? "on" : "only-on-failure",
    video: preserveMedia ? "on" : "retain-on-failure",
    ...devices["Desktop Chrome"],
    colorScheme: "light",
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "light",
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  webServer: {
    command: "npx storybook dev --ci --port 6006",
    url: "http://127.0.0.1:6006",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
