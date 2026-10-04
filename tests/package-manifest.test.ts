import { access, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface WorkflowStep {
  id?: string;
  name?: string;
  if?: string;
  env?: Record<string, string>;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  "runs-on"?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  steps?: WorkflowStep[];
}

interface Workflow {
  on?: Record<string, unknown>;
  jobs: Record<string, WorkflowJob>;
}

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
  name?: string;
  version?: string;
  main?: string;
  types?: string;
  bin?: Record<string, string>;
  exports?: Record<string, { default?: string; types?: string }>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  files?: string[];
  packageManager?: string;
  scripts?: Record<string, string>;
};

const tsconfig = JSON.parse(
  await readFile(new URL("../tsconfig.json", import.meta.url), "utf8"),
) as {
  compilerOptions?: { types?: string[] };
};
const biomeConfig = JSON.parse(
  await readFile(new URL("../biome.json", import.meta.url), "utf8"),
) as {
  $schema?: string;
  files?: { includes?: string[] };
  linter?: {
    domains?: Record<string, string>;
    rules?: { recommended?: boolean };
  };
  overrides?: Array<{
    includes?: string[];
    linter?: { domains?: Record<string, string> };
  }>;
};
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const ciWorkflow = parse(
  await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
) as Workflow;
const publishWorkflow = parse(
  await readFile(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8"),
) as Workflow;

function namedStep(job: WorkflowJob, name: string): WorkflowStep {
  const step = job.steps?.find((candidate) => candidate.name === name);
  expect(step, `Missing workflow step: ${name}`).toBeDefined();
  return step as WorkflowStep;
}

function runLines(job: WorkflowJob): string[] {
  return (
    job.steps?.flatMap((step) =>
      step.run
        ? step.run
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
        : [],
    ) ?? []
  );
}

describe("package manifest compatibility", () => {
  it("publishes the @npv12 fork identity on the current Node runtime", () => {
    expect(pkg.name).toBe("@npv12/opencode-quota");
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u);
    expect(pkg.packageManager).toBeUndefined();
    expect(pkg.engines?.node).toBe("^22.13.0 || >=23.4.0");
    expect(pkg.engines).not.toHaveProperty("opencode");
    expect(readme).toContain("Node.js `22.13+` or `23.4+`");
    expect(readme).not.toContain("OpenCode `>= 1.4.3`");
  });

  it("keeps the OpenCode V2 plugin dependency override", () => {
    expect(pkg.peerDependencies?.["@opencode/plugin"]).toBe("2.0.16");
    expect(pkg.devDependencies?.["@opencode/plugin"]).toBe("2.0.16");
    expect(pkg.dependencies?.["@opentui/core"]).toBe("^0.5.10");
    expect(pkg.dependencies?.["@opentui/solid"]).toBe("^0.5.10");
    expect(pkg.devDependencies?.typescript).toBe("7.0.2");
    expect(pkg.devDependencies?.yaml).toBe("^2.8.3");
    expect(tsconfig.compilerOptions?.types).toEqual(["node"]);
  });

  it("drops the removed CLI setup and hook tooling", () => {
    expect(pkg.dependencies).not.toHaveProperty("@clack/prompts");
    expect(pkg.dependencies).not.toHaveProperty("jsonc-parser");
    expect(pkg.devDependencies).not.toHaveProperty("lefthook");
    expect(pkg.devDependencies).not.toHaveProperty("husky");
    expect(pkg.scripts).not.toHaveProperty("prepare");
  });

  it("uses pinned Biome as the formatter and linter", async () => {
    expect(pkg.devDependencies?.["@biomejs/biome"]).toBe("2.3.11");
    expect(pkg.scripts?.format).toBe("biome format --write .");
    expect(pkg.scripts?.["format:check"]).toBe("biome format .");
    expect(pkg.scripts?.lint).toBe("biome lint .");
    expect(pkg.scripts?.check).toBe("biome check .");

    expect(biomeConfig.$schema).toBe("https://biomejs.dev/schemas/2.3.11/schema.json");
    expect(biomeConfig.linter?.rules?.recommended).toBe(true);
    expect(biomeConfig.linter?.domains?.solid).toBe("recommended");
    expect(
      biomeConfig.overrides?.some(
        (override) =>
          override.includes?.includes("tests/**/*.test.ts") &&
          override.linter?.domains?.test === "recommended",
      ),
    ).toBe(true);
    expect(biomeConfig.files?.includes).not.toContain("!!references/upstream-plugins");
    expect(biomeConfig.files?.includes).not.toContain("!!pnpm-lock.yaml");
  });

  it("ships the OpenTelemetry API while keeping the metrics SDK host-owned", () => {
    expect(pkg).not.toHaveProperty("optionalDependencies");
    expect(pkg.dependencies?.["@opentelemetry/api"]).toBe("^1.9.1");
    for (const dependencyType of [pkg.devDependencies, pkg.peerDependencies]) {
      expect(dependencyType).not.toHaveProperty("@opentelemetry/api");
    }
    expect(pkg.devDependencies?.["@opentelemetry/sdk-metrics"]).toBe("2.10.0");
    for (const dependencyType of [pkg.dependencies, pkg.peerDependencies]) {
      expect(dependencyType).not.toHaveProperty("@opentelemetry/sdk-metrics");
    }
  });

  it("defines a small build, typecheck, and test script set", () => {
    expect(pkg.scripts?.build).toBe(
      "node scripts/clean-dist.mjs && tsc && node scripts/copy-data.mjs && node scripts/prepare-tui-dist.mjs",
    );
    expect(pkg.scripts?.typecheck).toBe("tsc --noEmit");
    expect(pkg.scripts?.test).toBe("vitest run");
    expect(pkg.scripts?.["verify:release-version"]).toBe("node scripts/verify-release-version.mjs");
    expect(pkg.scripts).not.toHaveProperty("verify");
    expect(pkg.scripts).not.toHaveProperty("prepublishOnly");
  });

  it("ships explicit root, server, and tui entrypoints without making root the TUI", () => {
    expect(pkg.main).toBe("./dist/index.js");
    expect(pkg.types).toBe("./dist/index.d.ts");
    expect(pkg.bin).toEqual({
      "opencode-quota": "./dist/bin/opencode-quota.js",
    });
    expect(pkg.exports?.["."]).toEqual({
      default: "./dist/index.js",
      types: "./dist/index.d.ts",
    });
    expect(pkg.exports?.["./server"]).toEqual({
      default: "./dist/index.js",
      types: "./dist/index.d.ts",
    });
    expect(pkg.exports?.["./tui"]).toEqual({
      default: "./dist/tui.js",
      types: "./dist/tui.d.ts",
    });
    expect(pkg.files).toEqual(["dist", "README.md", "LICENSE"]);
  });

  it("keeps the legacy MiniMax result types in generated public declarations", async () => {
    const [indexDeclarations, typesDeclarations] = await Promise.all([
      readFile(new URL("../dist/index.d.ts", import.meta.url), "utf8"),
      readFile(new URL("../dist/lib/types.d.ts", import.meta.url), "utf8"),
    ]);

    expect(indexDeclarations).toMatch(/MiniMaxResult[\s\S]*MiniMaxResultEntry/u);
    expect(typesDeclarations).toContain("export interface MiniMaxResultEntry {");
    expect(typesDeclarations).toContain('window: "five_hour" | "weekly";');
    expect(typesDeclarations).toContain("export type MiniMaxResult = {");
    expect(typesDeclarations).toContain("entries: MiniMaxResultEntry[];");
  });

  it("removes the pnpm, lefthook, and upstream reference tooling", async () => {
    for (const path of [
      "../pnpm-lock.yaml",
      "../pnpm-workspace.yaml",
      "../lefthook.yml",
      "../references/upstream-plugins",
      "../scripts/verify-typescript-version.mjs",
      "../scripts/verify-v4-history.mjs",
      "../scripts/check-upstream-plugin-updates.mjs",
    ]) {
      await expect(access(new URL(path, import.meta.url))).rejects.toThrow();
    }

    await expect(access(new URL("../bun.lock", import.meta.url))).resolves.toBeUndefined();
  });

  it("runs one Bun CI job for install, check, typecheck, build, and tests", () => {
    expect(Object.keys(ciWorkflow.jobs)).toEqual(["quality"]);
    const quality = ciWorkflow.jobs.quality;
    expect(quality["runs-on"]).toBe("ubuntu-latest");
    expect(quality.steps?.some((step) => step.uses === "oven-sh/setup-bun@v2")).toBe(true);
    expect(quality.steps?.some((step) => step.uses === "actions/setup-node@v4")).toBe(true);

    const lines = runLines(quality);
    expect(lines).toEqual([
      "bun install --frozen-lockfile",
      "bun run check",
      "bun run typecheck",
      "bun run build",
      "bun run test",
    ]);
  });

  it("publishes one release-tag job with provenance and OIDC", () => {
    expect(publishWorkflow.on).toEqual({
      release: { types: ["published"] },
      workflow_dispatch: null,
    });
    expect(Object.keys(publishWorkflow.jobs)).toEqual(["publish"]);

    const publish = publishWorkflow.jobs.publish;
    expect(publish.permissions).toEqual({ contents: "write", "id-token": "write" });

    const checkout = publish.steps?.find((step) => step.uses === "actions/checkout@v6");
    expect(checkout?.with?.ref).toBe("${{ github.sha }}");

    const identity = namedStep(publish, "Assert release ref, tag, and commit match");
    expect(identity.if).toBe("github.event_name == 'release'");
    const identityRun = identity.run ?? "";
    expect(identityRun).toContain('CHECKED_OUT_SHA="$(git rev-parse HEAD)"');
    expect(identityRun).toContain('TAG_SHA="$(git rev-parse "$RELEASE_TAG^{commit}")"');

    expect(namedStep(publish, "Verify package version matches release tag").run).toBe(
      "bun run verify:release-version",
    );
    expect(namedStep(publish, "Install dependencies").run).toBe("bun install --frozen-lockfile");
    expect(namedStep(publish, "Verify tarball contents").run).toBe(
      "npm pack --dry-run --ignore-scripts",
    );

    const publishRun = namedStep(publish, "Publish to npm").run ?? "";
    expect(publishRun).toBe("npm publish --access public --provenance --ignore-scripts");
    expect(publishRun).not.toContain("pnpm");
  });

  it("sets the release version before verification and building, accepting unchanged versions", () => {
    const publish = publishWorkflow.jobs.publish;
    const version = namedStep(publish, "Set version from release tag");
    expect(version.if).toBe("github.event_name == 'release'");
    expect(version.env).toEqual({ RELEASE_TAG: `\${{ github.event.release.tag_name }}` });
    expect(version.run).toBe(
      `npm version "\${RELEASE_TAG#v}" --no-git-tag-version --allow-same-version --ignore-scripts`,
    );

    const steps = publish.steps ?? [];
    expect(steps.indexOf(version)).toBeLessThan(
      steps.indexOf(namedStep(publish, "Verify package version matches release tag")),
    );
    expect(steps.indexOf(version)).toBeLessThan(steps.indexOf(namedStep(publish, "Build")));
  });

  it("updates current main only after publication and skips empty version commits", () => {
    const publish = publishWorkflow.jobs.publish;
    const checkout = namedStep(publish, "Checkout main for version bump");
    expect(checkout.if).toBe("github.event_name == 'release'");
    expect(checkout.uses).toBe("actions/checkout@v6");
    expect(checkout.with?.ref).toBe("main");

    const versionCommit = namedStep(publish, "Commit and push version bump");
    expect(versionCommit.if).toBe("github.event_name == 'release'");
    expect(versionCommit.env).toEqual({ RELEASE_TAG: `\${{ github.event.release.tag_name }}` });
    expect(versionCommit.run).toContain(
      `npm version "\${RELEASE_TAG#v}" --no-git-tag-version --allow-same-version --ignore-scripts`,
    );
    expect(versionCommit.run).toContain("git add package.json");
    expect(versionCommit.run).toContain("if git diff --cached --quiet; then\n  exit 0\nfi");
    expect(versionCommit.run).toContain(`git commit -m "chore: release v\${RELEASE_TAG#v}"`);
    expect(versionCommit.run).toContain("git push origin HEAD:main");
    expect(versionCommit.run).not.toContain("--force");

    const steps = publish.steps ?? [];
    expect(steps.indexOf(namedStep(publish, "Publish to npm"))).toBeLessThan(
      steps.indexOf(checkout),
    );
    expect(steps.indexOf(checkout)).toBeLessThan(steps.indexOf(versionCommit));
  });

  it("keeps no announcement or removed-command residue in shipped docs", async () => {
    for (const path of [
      "../README.md",
      "../CONTRIBUTING.md",
      "../package.json",
      "../.github/ISSUE_TEMPLATE/bug_report.yml",
    ]) {
      const source = await readFile(new URL(path, import.meta.url), "utf8");
      for (const removed of [
        "quota_announcements",
        "maintainerAnnouncements",
        "pricing_refresh",
        "tokens_today",
        "/quota_status",
        "enableToast",
      ]) {
        expect(source, `${path} contains ${removed}`).not.toContain(removed);
      }
    }

    expect(readme).not.toContain("provider add");
  });
});
