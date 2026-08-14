import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const check = args.includes("--check");
const positional = args.filter((arg) => arg !== "--check");
const root = resolve(positional[0] ?? "dist/ui");
const output = resolve(positional[1] ?? "artifacts/ui-bundle-report.json");
const maxInitial = Number(process.env.UI_MAX_INITIAL_BYTES ?? 500000);
const manifestCandidates = [join(root, "manifest.json"), join(root, ".vite", "manifest.json")];
const manifestPath = manifestCandidates.find((candidate) => existsSync(candidate));
if (!manifestPath) throw new Error(`UI manifest not found under ${root}`);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const entries = Object.entries(manifest).filter(([, value]) => value.isEntry);
const fileSizes = new Map();
async function size(file) { if (!fileSizes.has(file)) fileSizes.set(file, (await stat(join(root, file))).size); return fileSizes.get(file); }
const imports = new Set();
async function collect(entry) { if (!entry || imports.has(entry)) return 0; imports.add(entry); const value = manifest[entry]; if (!value) return 0; let total = await size(value.file); for (const dependency of value.imports ?? []) total += await collect(dependency); return total; }
const report = [];
for (const [name, value] of entries) { const initialBytes = await collect(name); report.push({ name, file: value.file, initialBytes, dynamicImports: value.dynamicImports ?? [] }); }
const allAssets = (await Promise.all(Object.values(manifest).map(async (value) => ({ file: value.file, bytes: await size(value.file) })))).sort((a, b) => b.bytes - a.bytes);
const result = { generatedAt: new Date().toISOString(), root, manifest: manifestPath, maxInitialBytes: maxInitial, entries: report, largestAssets: allAssets.slice(0, 20) };
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.table(report.map(({ name, file, initialBytes }) => ({ name, file, initialKB: Math.round(initialBytes / 1024) })));
if (check && report.some((entry) => entry.initialBytes > maxInitial)) { throw new Error(`Initial UI bundle exceeds ${maxInitial} bytes`); }
