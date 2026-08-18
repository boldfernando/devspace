#!/usr/bin/env node
import { runCanonicalReverse } from "./index.js";
import { safeToolErrorContent } from "../error-policy.js";

try {
  process.exitCode = runCanonicalReverse(process.argv.slice(2));
} catch (error) {
  console.error(safeToolErrorContent(error));
  process.exitCode = 1;
}
