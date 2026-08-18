import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertAllowedPath, expandHomePath, resolveAllowedPath, resolveAllowedPathReal } from "./roots.js";

const home = homedir();

assert.equal(expandHomePath("~"), home);
assert.equal(expandHomePath("~/personal/devspace"), resolve(home, "personal", "devspace"));
assert.equal(expandHomePath("~user/project"), "~user/project");
assert.equal(expandHomePath("$HOME/project"), "$HOME/project");

assert.equal(
  assertAllowedPath("~/personal/devspace", [join(home, "personal")]),
  resolve(home, "personal", "devspace"),
);

assert.equal(
  assertAllowedPath("~/personal/devspace", ["~/personal"]),
  resolve(home, "personal", "devspace"),
);

assert.equal(
  resolveAllowedPath("~/file.txt", "/workspace", ["/workspace"]),
  resolve("/workspace", "~/file.txt"),
);

if (process.platform === "win32") {
  assert.throws(
    () => assertAllowedPath("C:\\Users\\Administrator", ["G:\\Projects\\Dev\\Github\\devspace"]),
    /Path is outside allowed roots/,
  );
}

const containmentRoot = await mkdtemp(join(tmpdir(), "devspace-root-containment-"));
const containmentOutside = await mkdtemp(join(tmpdir(), "devspace-root-containment-outside-"));
try {
  await writeFile(join(containmentOutside, "secret.txt"), "outside\n");
  await symlink(
    containmentOutside,
    join(containmentRoot, "outside-link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    resolveAllowedPathReal("outside-link/secret.txt", containmentRoot, [containmentRoot]),
    /Path is outside allowed roots/,
  );
  assert.equal(
    await resolveAllowedPathReal("new/nested.txt", containmentRoot, [containmentRoot]),
    join(containmentRoot, "new", "nested.txt"),
  );
} finally {
  await rm(containmentRoot, { recursive: true, force: true });
  await rm(containmentOutside, { recursive: true, force: true });
}
