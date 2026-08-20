import { loadConfig } from "../../dist/config.js";

const base = {
  DEVSPACE_ALLOWED_ROOTS: process.cwd(),
  DEVSPACE_OAUTH_OWNER_TOKEN: "security-audit-owner-token",
  DEVSPACE_CONFIG_DIR: process.cwd() + "/artifacts/security-audit/empty-config",
  DEVSPACE_STATE_DIR: process.cwd() + "/artifacts/security-audit/probe-state",
};

for (const value of [
  "javascript:alert(1)",
  "data:text/html,<svg/onload=alert(1)>",
  "https://user:pass@example.com",
  "https://example.com/path?x=1#fragment",
  "https://example.com/\" onerror=alert(1)",
]) {
  try {
    const config = loadConfig({ ...base, DEVSPACE_PUBLIC_BASE_URL: value });
    console.log(JSON.stringify({ input: value, accepted: true, normalized: config.publicBaseUrl }));
  } catch (error) {
    console.log(JSON.stringify({ input: value, accepted: false, error: error instanceof Error ? error.message : String(error) }));
  }
}

process.exit(0);
