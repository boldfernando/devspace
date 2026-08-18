import { homedir } from "node:os";
import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export function expandHomePath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return resolve(homedir(), path.slice(2));
  }

  return path;
}

export function isPathInsideRoot(path: string, root: string): boolean {
  const resolvedPath = resolve(expandHomePath(path));
  const resolvedRoot = resolve(expandHomePath(root));
  const relationship = relative(resolvedRoot, resolvedPath);

  return (
    relationship === "" ||
    (!isAbsolute(relationship) &&
      !relationship.startsWith("..") &&
      relationship !== ".." &&
      !relationship.includes(`..${sep}`))
  );
}

export function assertAllowedPath(path: string, allowedRoots: string[]): string {
  const resolvedPath = resolve(expandHomePath(path));
  if (allowedRoots.some((root) => isPathInsideRoot(resolvedPath, root))) {
    return resolvedPath;
  }

  throw new AccessDeniedError(`Path is outside allowed roots: ${path}`);
}

export function resolveAllowedPath(inputPath: string, cwd: string, allowedRoots: string[]): string {
  const absolutePath = resolve(cwd, inputPath);
  return assertAllowedPath(absolutePath, allowedRoots);
}

/**
 * Resolve a path through the filesystem before checking containment. This
 * blocks an allowed-root path from escaping through an existing symlink or a
 * symlinked parent while still allowing a new file below an allowed root.
 */
export async function resolveAllowedPathReal(
  inputPath: string,
  cwd: string,
  allowedRoots: string[],
): Promise<string> {
  const absolutePath = resolve(cwd, inputPath);
  const realRoots = await Promise.all(allowedRoots.map((root) => realpathForContainment(resolve(expandHomePath(root)))));
  const realPath = await realpathForContainment(absolutePath);
  if (realRoots.some((root) => isPathInsideRoot(realPath, root))) return absolutePath;

  throw new AccessDeniedError(`Path is outside allowed roots: ${inputPath}`);
}

async function realpathForContainment(path: string): Promise<string> {
  const suffix: string[] = [];
  let current = resolve(path);

  while (true) {
    try {
      const existing = await realpath(current);
      return suffix.reduceRight((parent, part) => join(parent, part), existing);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      suffix.push(basename(current));
      current = parent;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}
