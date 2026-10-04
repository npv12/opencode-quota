import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeDirs = vi.hoisted(() => ({
  value: {
    dataDir: "",
    configDir: "",
    cacheDir: "",
    stateDir: "",
  },
}));

vi.mock("../src/lib/opencode-runtime-paths.js", () => ({
  getOpencodeRuntimeDirs: () => runtimeDirs.value,
}));

import { extractProviderIdsFromParsedConfig } from "../src/lib/config-file-utils.js";
import {
  loadConfiguredOpenCodeConfig,
  loadConfiguredProviderIds,
} from "../src/lib/opencode-config-providers.js";

describe("opencode config provider discovery", () => {
  let tempDir: string;
  let globalConfigDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "opencode-quota-config-providers-"));
    globalConfigDir = join(tempDir, "global-config", "opencode");
    workspaceDir = join(tempDir, "workspace");
    mkdirSync(globalConfigDir, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });
    runtimeDirs.value = {
      dataDir: join(tempDir, "data"),
      configDir: globalConfigDir,
      cacheDir: join(tempDir, "cache"),
      stateDir: join(tempDir, "state"),
    };
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("extracts root-level provider ids and ignores malformed provider sections", () => {
    expect(
      extractProviderIdsFromParsedConfig({
        provider: {
          " copilot ": {},
          openai: {},
          "": {},
        },
      }),
    ).toEqual(["copilot", "openai"]);

    expect(extractProviderIdsFromParsedConfig({ provider: [] })).toEqual([]);
    expect(extractProviderIdsFromParsedConfig({ tui: { provider: { copilot: {} } } })).toEqual([]);
  });

  it("loads provider ids from global and workspace opencode config files", async () => {
    writeFileSync(
      join(globalConfigDir, "opencode.json"),
      JSON.stringify({ provider: { copilot: {}, openai: {} } }),
      "utf8",
    );
    writeFileSync(
      join(workspaceDir, "opencode.jsonc"),
      '{\n  // workspace providers\n  "provider": { "openai": {}, "gemini-cli": {}, },\n}',
      "utf8",
    );

    await expect(loadConfiguredProviderIds({ configRootDir: workspaceDir })).resolves.toEqual([
      "copilot",
      "openai",
      "gemini-cli",
    ]);
  });

  it("infers provider ids from known companion plugin specs", async () => {
    writeFileSync(
      join(workspaceDir, "opencode.json"),
      JSON.stringify({
        plugin: [
          "opencode-gemini-auth",
          "cursor-opencode-provider/plugin/opencode2",
          "@npv12/opencode-quota",
        ],
      }),
      "utf8",
    );

    await expect(loadConfiguredProviderIds({ configRootDir: workspaceDir })).resolves.toEqual([
      "google-gemini-cli",
      "cursor",
    ]);
  });

  it("does not infer Cursor from OpenCode 1-only Cursor companion plugins", async () => {
    writeFileSync(
      join(workspaceDir, "opencode.json"),
      JSON.stringify({
        plugin: [
          "@playwo/opencode-cursor-oauth",
          "opencode-cursor-oauth",
          "@rama_nigg/open-cursor",
        ],
      }),
      "utf8",
    );

    await expect(loadConfiguredProviderIds({ configRootDir: workspaceDir })).resolves.toEqual([]);
  });

  it("deduplicates provider ids inferred from provider blocks and plugin specs", async () => {
    writeFileSync(
      join(globalConfigDir, "opencode.json"),
      JSON.stringify({ plugin: ["cursor-opencode-provider"] }),
      "utf8",
    );
    writeFileSync(
      join(workspaceDir, "opencode.json"),
      JSON.stringify({
        provider: { "alibaba-coding-plan": {}, cursor: {} },
        plugin: [["cursor-opencode-provider/server", { enabled: true }]],
      }),
      "utf8",
    );

    await expect(loadConfiguredProviderIds({ configRootDir: workspaceDir })).resolves.toEqual([
      "alibaba-coding-plan",
      "cursor",
    ]);
  });

  it("reads OpenCode 2 native providers and plugins alongside the legacy keys", async () => {
    writeFileSync(
      join(globalConfigDir, "opencode.json"),
      JSON.stringify({ providers: { deepseek: {} }, plugins: ["opencode-gemini-auth"] }),
      "utf8",
    );
    writeFileSync(
      join(workspaceDir, "opencode.json"),
      JSON.stringify({
        provider: { openai: {} },
        plugins: [
          { package: "cursor-opencode-provider/plugin/opencode2", options: { enabled: true } },
        ],
      }),
      "utf8",
    );

    await expect(loadConfiguredProviderIds({ configRootDir: workspaceDir })).resolves.toEqual([
      "openai",
      "deepseek",
      "google-gemini-cli",
      "cursor",
    ]);
  });

  it("loads a merged OpenCode config view for standalone clients", async () => {
    writeFileSync(
      join(globalConfigDir, "opencode.json"),
      JSON.stringify({
        provider: { google: { options: { projectId: "global-project" } } },
      }),
      "utf8",
    );
    writeFileSync(
      join(workspaceDir, "opencode.json"),
      JSON.stringify({
        provider: { copilot: {} },
        plugin: ["@npv12/opencode-quota"],
        experimental: { quotaToast: { enabledProviders: ["copilot"] } },
      }),
      "utf8",
    );

    await expect(
      loadConfiguredOpenCodeConfig({ configRootDir: workspaceDir }),
    ).resolves.toMatchObject({
      provider: {
        google: { options: { projectId: "global-project" } },
        copilot: {},
      },
      plugin: ["@npv12/opencode-quota"],
      experimental: { quotaToast: { enabledProviders: ["copilot"] } },
    });
  });

  it("uses one selected format per scope and lets project provider declarations override global", async () => {
    writeFileSync(
      join(globalConfigDir, "opencode.json"),
      JSON.stringify({
        provider: {
          shared: { options: { baseURL: "https://global.example.test" } },
          globalOnly: {},
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(workspaceDir, "opencode.json"),
      JSON.stringify({
        provider: {
          ignoredJson: {},
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(workspaceDir, "opencode.jsonc"),
      `{
        // Project declarations are read-only inputs and override global declarations here.
        "provider": {
          "shared": { "options": { "baseURL": "https://project.example.test" } },
          "projectOnly": {},
        },
      }`,
      "utf8",
    );

    const before = await import("node:fs/promises").then(({ readFile }) =>
      readFile(join(workspaceDir, "opencode.jsonc"), "utf8"),
    );
    await expect(
      loadConfiguredOpenCodeConfig({ configRootDir: workspaceDir }),
    ).resolves.toMatchObject({
      provider: {
        shared: { options: { baseURL: "https://project.example.test" } },
        globalOnly: {},
        projectOnly: {},
      },
    });
    await expect(loadConfiguredProviderIds({ configRootDir: workspaceDir })).resolves.toEqual([
      "shared",
      "globalOnly",
      "projectOnly",
    ]);
    const after = await import("node:fs/promises").then(({ readFile }) =>
      readFile(join(workspaceDir, "opencode.jsonc"), "utf8"),
    );
    expect(after).toBe(before);
  });

  it("ignores missing, malformed, and parse-failing provider config files", async () => {
    writeFileSync(join(globalConfigDir, "opencode.json"), "{ nope", "utf8");
    writeFileSync(
      join(workspaceDir, "opencode.json"),
      JSON.stringify({ provider: ["copilot"] }),
      "utf8",
    );

    await expect(loadConfiguredProviderIds({ configRootDir: workspaceDir })).resolves.toEqual([]);
  });
});
