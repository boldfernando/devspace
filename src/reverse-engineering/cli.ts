#!/usr/bin/env node
import { runCanonicalReverse } from "./index.js";

try {
  process.exitCode = runCanonicalReverse(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
