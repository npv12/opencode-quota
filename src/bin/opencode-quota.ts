#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = [
  "Usage:",
  "  npx @npv12/opencode-quota show [--provider <provider-id>] [--json] [--threshold <pct>]",
  "  npx @npv12/opencode-quota --help",
  "",
  "Commands:",
  "  show    Print a quick quota glance",
  "          --json               Machine-readable JSON output (reads from cache)",
  "          --threshold <pct>    With --json, exit 1 if below <pct>%, 2 if incomplete/not comparable",
  "          --provider <id>      Filter to one provider",
].join("\n");

function printUsage(): void {
  console.log(USAGE);
}

function resolveCliPath(filePath: string): string {
  try {
    return realpathSync.native(filePath);
  } catch {
    return resolve(filePath);
  }
}

export function cliShouldRunMain(
  argv1: string | undefined = process.argv[1],
  modulePath: string = fileURLToPath(import.meta.url),
  resolvePath: (filePath: string) => string = resolveCliPath,
): boolean {
  if (!argv1) {
    return false;
  }

  return resolvePath(modulePath) === resolvePath(argv1);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = argv;

  if (!command) {
    printUsage();
    return 1;
  }

  if (command === "--help" || command === "-h" || command === "help") {
    printUsage();
    return 0;
  }

  if (command === "show") {
    const { runCliShowCommand } = await import("../lib/cli-show.js");
    return await runCliShowCommand({ argv: rest });
  }

  console.error(`Unknown command: ${command}`);
  printUsage();
  return 1;
}

if (cliShouldRunMain()) {
  main().then((code) => {
    if (code !== 0) {
      process.exit(code);
    }
  });
}
