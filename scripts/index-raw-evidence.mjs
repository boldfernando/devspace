#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const argv = process.argv.slice(2);
const repoIndex = argv.indexOf("--repo");
const repoRoot = resolve(repoIndex >= 0 ? argv[repoIndex + 1] : process.cwd());
const artifactsRoot = join(repoRoot, "artifacts");
const archiveRoot = join(repoRoot, "evidence", "raw");
const manifestPath = join(repoRoot, "evidence", "raw-evidence-manifest.json");
const indexPath = join(repoRoot, "docs", "raw-evidence-index.md");
const textExtensions = new Set([".json", ".log", ".md", ".txt", ".html", ".csv", ".yml", ".yaml"]);
const sensitivePattern = /Bearer\s+[A-Za-z0-9._~-]{12,}|(owner[_-]?token|access[_-]?token|refresh[_-]?token|code[_-]?verifier|device[_-]?code|client[_-]?secret)\s*[:=]\s*[^\s,}"']+|-----BEGIN (RSA|OPENSSH|EC|PRIVATE) KEY-----/i;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function category(relativePath) {
  if (relativePath.includes("wave1-p0")) return "wave1-p0";
  if (relativePath.includes("wave2-chaos")) return "wave2-chaos";
  if (relativePath.includes("wave3-performance")) return "wave3-performance";
  if (relativePath.includes("canonical-360")) return "canonical-360";
  if (relativePath.includes("green-status")) return "green-status";
  if (relativePath.includes("staging")) return "staging";
  if (relativePath.includes("idempotency")) return "idempotency";
  if (relativePath.includes("mcp")) return "mcp";
  return "other-evidence";
}

const sourcePaths = await walk(artifactsRoot);
await rm(archiveRoot, { recursive: true, force: true });
await mkdir(archiveRoot, { recursive: true });
await mkdir(join(repoRoot, "evidence"), { recursive: true });
await mkdir(join(repoRoot, "docs"), { recursive: true });

const records = [];
for (const [index, sourcePath] of sourcePaths.entries()) {
  const data = await readFile(sourcePath);
  const sourceRelativePath = relative(repoRoot, sourcePath).replaceAll("\\", "/");
  const archiveRelativePath = join("evidence", "raw", relative(artifactsRoot, sourcePath)).replaceAll("\\", "/");
  const archivePath = join(repoRoot, archiveRelativePath);
  await mkdir(join(archivePath, ".."), { recursive: true });
  await writeFile(archivePath, data);
  const extension = sourcePath.slice(sourcePath.lastIndexOf(".")).toLowerCase();
  let secretScan = "not_applicable_binary";
  if (textExtensions.has(extension)) secretScan = sensitivePattern.test(data.toString("utf8")) ? "potential_match" : "clean";
  const sourceHash = sha256(data);
  const archiveHash = sha256(await readFile(archivePath));
  records.push({
    id: `RAW-${String(index + 1).padStart(3, "0")}`,
    source_path: sourceRelativePath,
    archive_path: archiveRelativePath,
    category: category(sourceRelativePath),
    extension: extension || "none",
    bytes: data.byteLength,
    source_sha256: sourceHash,
    archive_sha256: archiveHash,
    byte_equal: sourceHash === archiveHash,
    secret_scan: secretScan,
    preservation: "exact_copy_source_unchanged",
  });
}

const manifest = {
  schema: "devspace.raw-evidence-manifest.v2",
  generated_at: new Date().toISOString(),
  repository: "devspace",
  policy: {
    source_files_unchanged: true,
    source_paths_relative_to_repo: true,
    archive_paths_relative_to_repo: true,
    hashes_sha256: true,
    archive_is_byte_exact: true,
    text_secret_scan: "deterministic_pattern_scan; potential_match_requires_review",
    binary_secret_scan: "not_applicable_binary",
    raw_content_rewritten: false,
  },
  count: records.length,
  total_bytes: records.reduce((sum, record) => sum + record.bytes, 0),
  records,
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const lines = [
  "# Raw evidence index",
  "",
  "> This index preserves the original artifact locations and a byte-exact, versionable archive for future analysis and references.",
  "",
  `- **Manifest:** [../evidence/raw-evidence-manifest.json](../evidence/raw-evidence-manifest.json)`,
  `- **Schema:** \`${manifest.schema}\``,
  `- **Files indexed and archived:** ${manifest.count}`,
  `- **Total archived bytes:** ${manifest.total_bytes}`,
  "- **Integrity:** each record has source and archive SHA-256 hashes plus a byte-equality assertion.",
  "- **Sanitization:** text files use a deterministic potential-secret pattern scan; binary files are marked not applicable. A potential match requires review before publication.",
  "",
  "## Reference table",
  "",
  "| ID | Category | Original source | Archived raw | Bytes | SHA-256 | Scan |",
  "| --- | --- | --- | --- | ---: | --- | --- |",
  ...records.map((record) => `| ${record.id} | ${record.category} | [${record.source_path}](../${record.source_path}) | [${record.archive_path}](../${record.archive_path}) | ${record.bytes} | \`${record.source_sha256}\` | ${record.secret_scan} |`),
  "",
  "## Usage",
  "",
  "Use the `id` when citing evidence in reports, decks, tests, or future skills. Use `archive_path` for reproducible analysis from a fresh checkout and `source_path` to locate the original runtime artifact. Verify the SHA-256 before comparing a recovered raw with a later copy. Do not edit either copy in place; generate a derivative under a new path and add a new manifest entry when redaction or transformation is required.",
  "",
];
await writeFile(indexPath, `${lines.join("\n")}\n`, "utf8");
console.log(`raw_evidence_archived=${records.length}`);
console.log(`raw_evidence_bytes=${manifest.total_bytes}`);
console.log("raw_evidence_manifest=written");
console.log("raw_evidence_index=written");
