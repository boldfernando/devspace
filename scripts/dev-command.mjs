export function buildDevServerCommand(execPath = process.execPath) {
  return {
    command: execPath,
    args: ["--import", "tsx", "src/cli.ts", "serve"],
  };
}
