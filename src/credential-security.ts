import { execFileSync } from "node:child_process";
import { chmodSync, statSync } from "node:fs";
import { userInfo } from "node:os";

export interface PrivateFilePermissionReport {
  platform: NodeJS.Platform;
  mode?: number;
  inherited?: boolean;
  ownerGrant?: boolean;
  broadPrincipalGrant?: boolean;
  equivalent0600: boolean;
}

/**
 * Apply a private-file policy to a credential/config file.
 *
 * POSIX systems use mode 0600. Windows disables inherited ACL entries and
 * grants access only to the current user and LocalSystem. If Windows ACL
 * hardening cannot be applied, the operation fails closed instead of silently
 * accepting the inherited ACL.
 */
export function hardenPrivateFile(filePath: string): void {
  chmodSync(filePath, 0o600);
  if (process.platform !== "win32") return;

  const principal = currentWindowsPrincipal();
  execFileSync(
    "icacls.exe",
    [filePath, "/inheritance:r", "/grant:r", `${principal}:F`, "SYSTEM:F"],
    {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

export function inspectPrivateFilePermissions(filePath: string): PrivateFilePermissionReport {
  const mode = statSync(filePath).mode & 0o777;
  if (process.platform !== "win32") {
    return {
      platform: process.platform,
      mode,
      equivalent0600: mode === 0o600,
    };
  }

  const output = execFileSync("icacls.exe", [filePath], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const normalizedPrincipal = currentWindowsPrincipal().toLowerCase();
  const inherited = lines.some((line) => /\(I\)/i.test(line));
  const broadPrincipalGrant = lines.some((line) =>
    /(?:^|\\)(?:everyone|authenticated users|users|network|interactive):/i.test(line),
  );
  const ownerGrant = lines.some((line) => {
    const normalized = line.toLowerCase();
    return normalized.startsWith(`${normalizedPrincipal}:`) && /\((?:f|m|r|rx|w)\)/i.test(normalized);
  });

  return {
    platform: process.platform,
    inherited,
    ownerGrant,
    broadPrincipalGrant,
    equivalent0600: !inherited && ownerGrant && !broadPrincipalGrant,
  };
}

export function assertPrivateFilePermissions(filePath: string): PrivateFilePermissionReport {
  const report = inspectPrivateFilePermissions(filePath);
  if (!report.equivalent0600) {
    throw new Error("Credential file ACL is not private enough for local storage");
  }
  return report;
}

function currentWindowsPrincipal(): string {
  try {
    const value = execFileSync("whoami.exe", [], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (value) return value;
  } catch {
    // Fall back to the username when whoami is not available in a restricted shell.
  }

  const username = userInfo().username.trim();
  if (!username) throw new Error("Unable to resolve the current Windows principal");
  return username;
}
