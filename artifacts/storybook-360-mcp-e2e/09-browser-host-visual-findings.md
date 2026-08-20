# Browser-host visual findings

The first browser-host run executed all seven stories but failed the axe gate on `color-contrast`: `.tool-label` and `.header-meta` rendered `#a3a3aa` over `#414141` at a 4.07:1 ratio, below the WCAG AA 4.5:1 threshold. The finding was emitted for every affected story and preserved in `09-browser-host-report.json`.

The production stylesheet was changed so `.tool-label` and `.header-meta` use `var(--color-text-secondary, #c7c7ce)`. A source-level accessibility contract was added for both selectors. The second run showed `violations: []` in the axe attachments for the stories that reached the screenshot step, proving the contrast defect was repaired.

The captured timeout and retry screenshots show valid, stable 1280x720 Storybook card renders. The update-snapshot attempt failed only while writing the visual baseline for `timeout` and `retry-and-tool-calling` with `TypeError: The "data" argument must be of type string or an instance of Buffer ... Received undefined`; the error occurred at `toHaveScreenshot`, after axe had passed. The other five stories reached baseline creation. This is an artifact/baseline-write issue to diagnose separately from the repaired accessibility defect; no visual PASS is claimed until the baseline write and subsequent comparison run both pass.
