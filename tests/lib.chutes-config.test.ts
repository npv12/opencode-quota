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

describe("chutes-config", () => {
  const originalEnv = process.env;
  const trustedPaths = getTrustedOpencodeConfigPaths();
  const workspacePaths = getWorkspaceOpencodeConfigPaths();
  let fsConfigMocks: Awaited<ReturnType<typeof loadFsConfigMocks>>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    resetProcessEnv(originalEnv, [
      "CHUTES_API_KEY",
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

  it("returns env var CHUTES_API_KEY when set", async () => {
    process.env.CHUTES_API_KEY = "env-key";

    const { resolveChutesApiKey } = await import("../src/lib/chutes-config.js");
    await expect(resolveChutesApiKey()).resolves.toEqual({
      key: "env-key",
      source: "env:CHUTES_API_KEY",
    });
  });

  it("reads from trusted global opencode.json", async () => {
    mockTrustedConfigFile(
      fsConfigMocks,
      trustedPaths.json,
      JSON.stringify({
        provider: {
          chutes: {
            options: {
              apiKey: "json-api-key",
            },
          },
        },
      }),
    );

    const { resolveChutesApiKey } = await import("../src/lib/chutes-config.js");
    await expect(resolveChutesApiKey()).resolves.toEqual({
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
          "chutes": {
            "options": {
              "apiKey": "jsonc-api-key"
            }
          }
        }
      }`,
    );

    const { resolveChutesApiKey } = await import("../src/lib/chutes-config.js");
    await expect(resolveChutesApiKey()).resolves.toEqual({
      key: "jsonc-api-key",
      source: "opencode.jsonc",
    });
  });

  it("rejects arbitrary env-template names in trusted config", async () => {
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");
    process.env.SOMETHING_ELSE = "should-not-be-used";

    mockTrustedConfigFile(
      fsConfigMocks,
      trustedPaths.json,
      JSON.stringify({
        provider: {
          chutes: {
            options: {
              apiKey: "{env:SOMETHING_ELSE}",
            },
          },
        },
      }),
    );
    (readAuthFile as any).mockResolvedValue(null);

    const { resolveChutesApiKey } = await import("../src/lib/chutes-config.js");
    await expect(resolveChutesApiKey()).resolves.toBeNull();
  });

  it.each([
    ["opencode.json", workspacePaths.json],
    ["opencode.jsonc", workspacePaths.jsonc],
  ])("ignores workspace-local %s when resolving provider secrets", async (_label, workspacePath) => {
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");

    fsConfigMocks.existsSync.mockImplementation((path: string) => path === workspacePath);
    (readAuthFile as any).mockResolvedValue(null);

    const { resolveChutesApiKey } = await import("../src/lib/chutes-config.js");
    await expect(resolveChutesApiKey()).resolves.toBeNull();
  });

  it("falls back to auth.json when no other sources are configured", async () => {
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");

    fsConfigMocks.existsSync.mockReturnValue(false);
    (readAuthFile as any).mockResolvedValue({
      chutes: {
        type: "api",
        key: "auth-key",
      },
    });

    const { resolveChutesApiKey } = await import("../src/lib/chutes-config.js");
    await expect(resolveChutesApiKey()).resolves.toEqual({
      key: "auth-key",
      source: "auth.json",
    });
  });

  it("returns diagnostics with source and checked paths", async () => {
    process.env.CHUTES_API_KEY = "diag-key";

    const { getChutesKeyDiagnostics } = await import("../src/lib/chutes-config.js");
    const result = await getChutesKeyDiagnostics();

    expect(result.configured).toBe(true);
    expect(result.source).toBe("env:CHUTES_API_KEY");
    expect(result.checkedPaths).toContain("env:CHUTES_API_KEY");
    expect(result.authPaths).toEqual(["/tmp/auth.json"]);
  });
});
