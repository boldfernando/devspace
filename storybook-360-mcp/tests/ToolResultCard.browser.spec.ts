import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const stories = [
  { id: "storybook-360-mcp-toolresultcard--success", name: "success" },
  { id: "storybook-360-mcp-toolresultcard--error", name: "error" },
  { id: "storybook-360-mcp-toolresultcard--empty", name: "empty" },
  { id: "storybook-360-mcp-toolresultcard--loading", name: "loading" },
  { id: "storybook-360-mcp-toolresultcard--timeout", name: "timeout" },
  { id: "storybook-360-mcp-toolresultcard--retry-and-tool-calling", name: "retry-and-tool-calling" },
  { id: "storybook-360-mcp-toolresultcard--streaming", name: "streaming" },
] as const;

async function openStory(page: Parameters<Parameters<typeof test>[2]>[0]["page"], storyId: string) {
  await page.goto(`/iframe.html?id=${storyId}&viewMode=story`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".tool-card")).toBeVisible();
}

async function runA11yScan(page: Parameters<Parameters<typeof test>[2]>[0]["page"], storyName: string, testInfo: Parameters<Parameters<typeof test>[2]>[0]["testInfo"]) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  await testInfo.attach(`axe-${storyName}`, {
    body: JSON.stringify({
      story: storyName,
      passes: result.passes.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.length })),
      incomplete: result.incomplete.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.length })),
      violations: result.violations.map(({ id, impact, help, nodes }) => ({ id, impact, help, nodes: nodes.length })),
    }, null, 2),
    contentType: "application/json",
  });
  expect(result.violations, `${storyName} has accessibility violations`).toEqual([]);
}

for (const story of stories) {
  test(`${story.name} renders in a real browser with no axe violations`, async ({ page }, testInfo) => {
    await openStory(page, story.id);
    await expect(page.locator(".tool-header")).toBeVisible();

    if (story.name === "retry-and-tool-calling") {
      const retry = page.getByRole("button", { name: "Try again" });
      if (!(await retry.isVisible())) {
        await page.locator(".tool-header").click();
      }
      await expect(retry).toBeVisible();
      await expect(page.getByRole("list", { name: "Tool calls" })).toBeVisible();
      await retry.click();
      await expect(page.getByText("Retry succeeded.")).toBeVisible();
    }

    if (story.name === "streaming") {
      const stream = page.getByLabel("Streaming output");
      if (!(await stream.isVisible())) {
        await page.locator(".tool-header").click();
      }
      await expect(stream).toHaveText("chunk one chunk two");
      await expect(page.getByRole("list", { name: "Tool calls" })).toBeVisible();
    }

    await runA11yScan(page, story.name, testInfo);
    const screenshot = await page.locator("main.shell").screenshot();
    await expect(screenshot).toMatchSnapshot(`${story.name}.png`);
  });
}
