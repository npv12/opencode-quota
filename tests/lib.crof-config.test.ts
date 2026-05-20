import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRuntimePathsMockModule,
  getTrustedOpencodeConfigPaths,
  getWorkspaceOpencodeConfigPaths,
  loadFsConfigMocks,
  mockTrustedConfigFile,
  resetFsConfigMocks,
  resetProcessEnv,
} from "./helpers/trusted-config-test-harness.js";

vi.mock("../src/lib/opencode-runtime-paths.js", () => createRuntimePathsMockModule());

vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("../src/lib/opencode-auth.js", () => ({
  getAuthPaths: vi.fn(() => ["/tmp/auth.json"]),
  readAuthFile: vi.fn(),
}));

describe("crof-config", () => {
  const originalEnv = process.env;
  const trustedPaths = getTrustedOpencodeConfigPaths();
  const workspacePaths = getWorkspaceOpencodeConfigPaths();
  let fsConfigMocks: Awaited<ReturnType<typeof loadFsConfigMocks>>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    resetProcessEnv(originalEnv, [
      "CROF_API_KEY",
      "CROFAI_API_KEY",
      "SOMETHING_ELSE",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_CACHE_HOME",
      "XDG_STATE_HOME",
    ]);
    fsConfigMocks = await loadFsConfigMocks();
    resetFsConfigMocks(fsConfigMocks);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns env var CROF_API_KEY when set", async () => {
    process.env.CROF_API_KEY = "env-key-1";

    const { resolveCrofApiKey } = await import("../src/lib/crof-config.js");
    await expect(resolveCrofApiKey()).resolves.toEqual({
      key: "env-key-1",
      source: "env:CROF_API_KEY",
    });
  });

  it("returns env var CROFAI_API_KEY when CROF_API_KEY is not set", async () => {
    process.env.CROFAI_API_KEY = "env-key-2";

    const { resolveCrofApiKey } = await import("../src/lib/crof-config.js");
    await expect(resolveCrofApiKey()).resolves.toEqual({
      key: "env-key-2",
      source: "env:CROFAI_API_KEY",
    });
  });

  it("reads from trusted global opencode.json", async () => {
    mockTrustedConfigFile(
      fsConfigMocks,
      trustedPaths.json,
      JSON.stringify({
        provider: {
          crof: {
            options: {
              apiKey: "json-api-key",
            },
          },
        },
      }),
    );

    const { resolveCrofApiKey } = await import("../src/lib/crof-config.js");
    await expect(resolveCrofApiKey()).resolves.toEqual({
      key: "json-api-key",
      source: "opencode.json",
    });
  });

  it("reads from trusted global opencode.jsonc", async () => {
    mockTrustedConfigFile(
      fsConfigMocks,
      trustedPaths.jsonc,
      `{
        "provider": {
          "crof": {
            "options": {
              "apiKey": "jsonc-api-key"
            }
          }
        }
      }`,
    );

    const { resolveCrofApiKey } = await import("../src/lib/crof-config.js");
    await expect(resolveCrofApiKey()).resolves.toEqual({
      key: "jsonc-api-key",
      source: "opencode.jsonc",
    });
  });

  it("rejects arbitrary env-template names in trusted config", async () => {
    process.env.SOMETHING_ELSE = "should-not-be-used";

    mockTrustedConfigFile(
      fsConfigMocks,
      trustedPaths.json,
      JSON.stringify({
        provider: {
          crof: {
            options: {
              apiKey: "{env:SOMETHING_ELSE}",
            },
          },
        },
      }),
    );

    const { resolveCrofApiKey } = await import("../src/lib/crof-config.js");
    await expect(resolveCrofApiKey()).resolves.toBeNull();
  });

  it.each([
    ["opencode.json", workspacePaths.json],
    ["opencode.jsonc", workspacePaths.jsonc],
  ])("ignores workspace-local %s when resolving provider secrets", async (_label, workspacePath) => {
    fsConfigMocks.existsSync.mockImplementation((path: string) => path === workspacePath);

    const { resolveCrofApiKey } = await import("../src/lib/crof-config.js");
    await expect(resolveCrofApiKey()).resolves.toBeNull();
  });

  it("falls back to auth.json when no other sources are configured", async () => {
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");

    fsConfigMocks.existsSync.mockReturnValue(false);
    (readAuthFile as any).mockResolvedValue({
      crof: {
        type: "api",
        key: "auth-key",
      },
    });

    const { resolveCrofApiKey } = await import("../src/lib/crof-config.js");
    await expect(resolveCrofApiKey()).resolves.toEqual({
      key: "auth-key",
      source: "auth.json",
    });
    expect(readAuthFile).toHaveBeenCalled();
  });

  it("returns diagnostics with source and checked paths", async () => {
    process.env.CROFAI_API_KEY = "diag-key";

    const { getCrofKeyDiagnostics } = await import("../src/lib/crof-config.js");
    const result = await getCrofKeyDiagnostics();

    expect(result.configured).toBe(true);
    expect(result.source).toBe("env:CROFAI_API_KEY");
    expect(result.checkedPaths).toContain("env:CROFAI_API_KEY");
    expect(result.authPaths).toEqual(["/tmp/auth.json"]);
  });
});
