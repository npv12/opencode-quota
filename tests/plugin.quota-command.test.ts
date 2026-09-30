import { rm } from "fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuotaProviderContext } from "../src/lib/entries.js";
import { renderPlainTextReport } from "../src/lib/report-document.js";
import { DEFAULT_CONFIG } from "../src/lib/types.js";
import {
  createAlibabaAuthModuleMock,
  createPluginTestClient as createClient,
  createConfigModuleMock,
  createPluginRuntimePathsMockModule,
  createPricingModuleMock,
  createProvidersRegistryModuleMock,
  createSessionTokensModuleMock,
  seedDefaultPluginBootstrapMocks,
} from "./helpers/plugin-test-harness.js";

const TEST_RUNTIME_ROOT = "/tmp/opencode-quota-plugin-quota-command-tests";
const TEST_ACCOUNTING = {
  resultType: "quota",
  acquisitionMethod: "remote_api",
  ownership: "maintained",
  authority: "provider_reported",
} as const;

async function buildDialogOutput(params: {
  client: ReturnType<typeof createClient>;
  sessionID: string;
  arguments?: string;
  generatedAtMs?: number;
  /** The line the TUI dialog shows under its title, in place of the report's title line. */
  subtitle?: string;
}) {
  const { buildQuotaDialogCommandOutput } = await import("../src/lib/quota-dialog-commands.js");
  // V2 CLI obtains host provider IDs from its location cache, not V1 plugin bootstrap.
  params.client.config.providers.mockResolvedValue({
    data: {
      providers: mocks.getProviders().map((provider: { id: string }) => ({ id: provider.id })),
    },
  });
  const result = await buildQuotaDialogCommandOutput({
    command: "quota",
    arguments: params.arguments,
    generatedAtMs: params.generatedAtMs,
    client: params.client,
    roots: {
      workspaceRoot: process.cwd(),
      configRoot: process.cwd(),
      fallbackDirectory: process.cwd(),
    },
    sessionID: params.sessionID,
    resolveSessionMeta: async (sessionID) => {
      const response = await params.client.session.get({ path: { id: sessionID } });
      return {
        modelID: response.data?.model?.id,
        providerID: response.data?.model?.providerID,
      };
    },
  });
  expect(params.client.session.prompt).not.toHaveBeenCalled();
  expect(result.state).toBe("output");
  if (result.state !== "output") return "";
  // Every command here renders its document as plain text.
  expect(renderPlainTextReport(result.document)).toBe(result.output);
  if (params.subtitle !== undefined) {
    expect(result.document.heading?.subtitle).toBe(params.subtitle);
  }
  return result.output;
}

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  getProviders: vi.fn(),
  maybeRefreshPricingSnapshot: vi.fn(),
  getPricingSnapshotMeta: vi.fn(),
  getPricingSnapshotSource: vi.fn(),
  getRuntimePricingRefreshStatePath: vi.fn(),
  getRuntimePricingSnapshotPath: vi.fn(),
  setPricingSnapshotAutoRefresh: vi.fn(),
  setPricingSnapshotSelection: vi.fn(),
  resolveAlibabaCodingPlanAuthCached: vi.fn(),
  fetchSessionTokensForDisplay: vi.fn(),
}));

vi.mock("../src/lib/config.js", () => createConfigModuleMock(mocks.loadConfig));

vi.mock("../src/providers/registry.js", () =>
  createProvidersRegistryModuleMock(mocks.getProviders),
);

vi.mock("../src/lib/modelsdev-pricing.js", () => createPricingModuleMock(mocks));

vi.mock("../src/lib/session-tokens.js", () =>
  createSessionTokensModuleMock(mocks.fetchSessionTokensForDisplay),
);

vi.mock("../src/lib/alibaba-auth.js", () =>
  createAlibabaAuthModuleMock(mocks.resolveAlibabaCodingPlanAuthCached),
);

vi.mock("../src/lib/opencode-runtime-paths.js", () =>
  createPluginRuntimePathsMockModule(TEST_RUNTIME_ROOT),
);

describe("/quota command behavior", () => {
  let savedConfigDir: string | undefined;

  beforeEach(async () => {
    savedConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
    mocks.loadConfig.mockReset();
    seedDefaultPluginBootstrapMocks(mocks, {
      configOverrides: {
        enabled: true,
        showSessionTokens: false,
        minIntervalMs: 60_000,
      },
      resetPluginState: true,
    });
    await rm(TEST_RUNTIME_ROOT, { recursive: true, force: true });
    const { __resetQuotaStateForTests } = await import("../src/lib/quota-state.js");
    __resetQuotaStateForTests();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (savedConfigDir !== undefined) process.env.OPENCODE_CONFIG_DIR = savedConfigDir;
    else delete process.env.OPENCODE_CONFIG_DIR;
    const { __resetQuotaStateForTests } = await import("../src/lib/quota-state.js");
    __resetQuotaStateForTests();
    await rm(TEST_RUNTIME_ROOT, { recursive: true, force: true });
  });

  it("recovers from a provider failure on the next CLI quota request", async () => {
    mocks.loadConfig.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabled: true,
      enabledProviders: ["openai"],
      minIntervalMs: 0,
      showSessionTokens: false,
    });
    const provider = {
      id: "openai",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary failure"))
        .mockResolvedValueOnce({
          attempted: true,
          entries: [{ accounting: TEST_ACCOUNTING, name: "After failure", percentRemaining: 69 }],
          errors: [],
        }),
    };
    mocks.getProviders.mockReturnValue([provider]);
    const client = createClient();
    await buildDialogOutput({ client, sessionID: "session-retry" });
    const recovered = await buildDialogOutput({ client, sessionID: "session-retry" });
    expect(provider.fetch).toHaveBeenCalledTimes(2);
    expect(recovered).toContain("After failure");
  });

  it("applies pricing snapshot selection from config on first use", async () => {
    mocks.loadConfig.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabled: true,
      pricingSnapshot: { source: "bundled", autoRefresh: 7 },
      showSessionTokens: false,
      minIntervalMs: 60_000,
    });

    const client = createClient();
    await buildDialogOutput({ client, sessionID: "session-init" });

    expect(mocks.loadConfig).toHaveBeenCalledWith(
      client,
      expect.any(Object),
      expect.objectContaining({ configRootDir: process.cwd() }),
    );
    expect(mocks.setPricingSnapshotSelection).toHaveBeenCalledWith("bundled");
    expect(mocks.setPricingSnapshotAutoRefresh).toHaveBeenCalledWith(7);
    expect(mocks.maybeRefreshPricingSnapshot).not.toHaveBeenCalled();
  });

  it("honors percentDisplayMode for /quota output", async () => {
    mocks.loadConfig.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabled: true,
      enabledProviders: ["openai"],
      showSessionTokens: false,
      percentDisplayMode: "used",
      minIntervalMs: 60_000,
    });

    const provider = {
      id: "openai",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [{ accounting: TEST_ACCOUNTING, name: "OpenAI Pro", percentRemaining: 81 }],
        errors: [],
      }),
    };
    mocks.getProviders.mockReturnValue([provider]);

    const client = createClient();

    const injected = await buildDialogOutput({
      client,
      sessionID: "session-quota-percent-display-boundary",
    });
    expect(injected).toContain("19% used");
    expect(injected).not.toContain("81% left");
  });

  it.each([
    { label: "default spaced resets", resetTimeSpaced: undefined, expectedReset: "2d 5h 14m" },
    { label: "the explicit dense-reset opt-out", resetTimeSpaced: false, expectedReset: "2d5h14m" },
  ])("applies bare percent labels and $label to /quota output", async ({
    resetTimeSpaced,
    expectedReset,
  }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));
    try {
      mocks.loadConfig.mockResolvedValue({
        ...DEFAULT_CONFIG,
        enabled: true,
        enabledProviders: ["openai"],
        showSessionTokens: false,
        percentDisplayMode: "used",
        percentLabelStyle: "bare",
        ...(resetTimeSpaced === undefined ? {} : { resetTimeSpaced }),
        minIntervalMs: 60_000,
      });

      const provider = {
        id: "openai",
        isAvailable: vi.fn().mockResolvedValue(true),
        fetch: vi.fn().mockResolvedValue({
          attempted: true,
          entries: [
            {
              accounting: TEST_ACCOUNTING,
              name: "OpenAI Pro",
              percentRemaining: 81,
              resetTimeIso: "2026-01-17T15:14:00.000Z",
            },
          ],
          errors: [],
        }),
      };
      mocks.getProviders.mockReturnValue([provider]);

      const client = createClient();

      const injected = await buildDialogOutput({
        client,
        sessionID: "session-quota-display-options",
      });
      expect(injected).toContain("Quota [Used] (/quota)");
      expect(injected).toContain("19%");
      expect(injected).not.toContain("19% used");
      expect(injected).toContain(expectedReset);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders provider errors even when no quota entries are returned", async () => {
    const provider = {
      id: "alibaba-coding-plan",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [],
        errors: [
          { label: "Alibaba Coding Plan", message: "Unsupported Alibaba Coding Plan tier: max" },
        ],
      }),
    };
    mocks.getProviders.mockReturnValue([provider]);

    const client = createClient();

    const injected = await buildDialogOutput({ client, sessionID: "session-errors" });
    expect(injected).toContain("Alibaba Coding Plan: Unsupported Alibaba Coding Plan tier: max");
  });

  it("converts provider fetch failures into injected quota errors", async () => {
    const provider = {
      id: "cursor",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockRejectedValue(new Error("sqlite busy")),
    };
    mocks.getProviders.mockReturnValue([provider]);

    const client = createClient({ modelID: "auto", providerID: "cursor" });

    const injected = await buildDialogOutput({ client, sessionID: "session-fetch-failure" });
    expect(injected).toContain("Cursor: Failed to read quota data");
  });

  it("reports explicit cursor providers with no local history as no local usage yet", async () => {
    mocks.loadConfig.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabled: true,
      enabledProviders: ["cursor"],
      showSessionTokens: false,
      minIntervalMs: 60_000,
    });

    const provider = {
      id: "cursor",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockResolvedValue({
        attempted: false,
        entries: [],
        errors: [],
      }),
    };
    mocks.getProviders.mockReturnValue([provider]);

    const client = createClient({ modelID: "auto", providerID: "cursor" });

    const injected = await buildDialogOutput({ client, sessionID: "session-cursor-empty" });
    expect(injected).toContain("Cursor: No local usage yet");
    expect(injected).not.toContain("Cursor: Not configured");
  });

  it("reports explicit Anthropic providers with local auth but no exposed quota windows", async () => {
    mocks.loadConfig.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabled: true,
      enabledProviders: ["anthropic"],
      showSessionTokens: false,
      minIntervalMs: 60_000,
    });

    const provider = {
      id: "anthropic",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockResolvedValue({
        attempted: false,
        entries: [],
        errors: [],
      }),
    };
    mocks.getProviders.mockReturnValue([provider]);

    const client = createClient({
      modelID: "anthropic/claude-sonnet-4-5",
      providerID: "anthropic",
    });

    const injected = await buildDialogOutput({ client, sessionID: "session-anthropic-empty" });
    expect(injected).toContain(
      "Anthropic: Quota unavailable via local Claude CLI or OAuth credentials",
    );
    expect(injected).not.toContain("Anthropic: Not configured");
  });

  it("reports Anthropic no-data guidance in auto mode when it is the only active provider", async () => {
    mocks.loadConfig.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabled: true,
      enabledProviders: "auto",
      showSessionTokens: false,
      minIntervalMs: 60_000,
    });

    const provider = {
      id: "anthropic",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockResolvedValue({
        attempted: false,
        entries: [],
        errors: [],
      }),
    };
    mocks.getProviders.mockReturnValue([provider]);

    const client = createClient({
      modelID: "anthropic/claude-sonnet-4-5",
      providerID: "anthropic",
    });

    const injected = await buildDialogOutput({ client, sessionID: "session-anthropic-auto-empty" });
    expect(injected).toContain(
      "Anthropic: Quota unavailable via local Claude CLI or OAuth credentials",
    );
  });

  it("does not diagnose filtered providers as detected-but-empty when onlyCurrentModel excludes them", async () => {
    mocks.loadConfig.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabled: true,
      onlyCurrentModel: true,
      showSessionTokens: false,
      minIntervalMs: 60_000,
    });

    const provider = {
      id: "cursor",
      matchesCurrentModel: vi.fn((model?: string) => model === "cursor/auto"),
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn(),
    };
    mocks.getProviders.mockReturnValue([provider]);

    const client = createClient({ modelID: "openai/gpt-5" });

    const injected = await buildDialogOutput({ client, sessionID: "session-filtered-out" });

    expect(provider.fetch).not.toHaveBeenCalled();
    expect(injected).toContain(
      "No enabled quota providers matched the current model: openai/gpt-5.",
    );
  });

  it("invalidates model-scoped custom provider output when only the current model changes", async () => {
    const quotaProviders = [
      {
        id: "shared-model-a",
        providerId: "shared-provider",
        label: "Shared Model A",
        mode: "remote-api" as const,
        url: "https://model-a.example/accounting",
        format: "quota-v1" as const,
        modelIds: ["model-a"],
      },
      {
        id: "shared-model-b",
        providerId: "shared-provider",
        label: "Shared Model B",
        mode: "remote-api" as const,
        url: "https://model-b.example/accounting",
        format: "quota-v1" as const,
        modelIds: ["model-b"],
      },
    ];
    mocks.loadConfig.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabled: true,
      enabledProviders: ["quota-providers"],
      quotaProviders,
      onlyCurrentModel: true,
      showSessionTokens: false,
      minIntervalMs: 60_000,
    });

    const { quotaProvidersProvider } = await import("../src/providers/quota-providers.js");
    const provider = {
      ...quotaProvidersProvider,
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockImplementation(async (ctx: QuotaProviderContext) => ({
        attempted: true,
        entries: [
          {
            accounting: TEST_ACCOUNTING,
            name: ctx.config.currentModel === "model-a" ? "Shared Model A" : "Shared Model B",
            percentRemaining: ctx.config.currentModel === "model-a" ? 95 : 60,
          },
        ],
        errors: [],
      })),
    };
    mocks.getProviders.mockReturnValue([provider]);

    const client = createClient({ modelID: "model-a", providerID: "shared-provider" });
    let currentSession = {
      data: { model: { id: "model-a", providerID: "shared-provider" } },
    };
    client.session.get = vi.fn().mockImplementation(async () => currentSession);

    const firstInjected = await buildDialogOutput({
      client,
      sessionID: "session-model-switch",
    });

    currentSession = {
      data: { model: { id: "model-b", providerID: "shared-provider" } },
    };

    const secondInjected = await buildDialogOutput({
      client,
      sessionID: "session-model-switch",
    });

    expect(firstInjected).toContain("95% left");
    expect(secondInjected).toContain("60% left");
    expect(secondInjected).not.toContain("95% left");
    expect(provider.fetch).toHaveBeenCalledTimes(2);
  });

  it("reuses shared quota-state across /quota sessions when render context matches", async () => {
    mocks.loadConfig.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabled: true,
      onlyCurrentModel: false,
      showSessionTokens: false,
      minIntervalMs: 60_000,
    });

    const provider = {
      id: "openai",
      cachePolicy: { kind: "account-neutral" as const },
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [{ accounting: TEST_ACCOUNTING, name: "OpenAI Pro", percentRemaining: 95 }],
        errors: [],
      }),
    };
    mocks.getProviders.mockReturnValue([provider]);

    const client = createClient();

    const firstOutput = await buildDialogOutput({ client, sessionID: "session-a" });
    const secondOutput = await buildDialogOutput({ client, sessionID: "session-b" });

    expect(provider.fetch).toHaveBeenCalledTimes(1);
    expect(firstOutput).toContain("95% left");
    expect(secondOutput).toContain("95% left");
  });

  it("keeps concurrent /quota session-token output isolated per session", async () => {
    mocks.loadConfig.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabled: true,
      showSessionTokens: true,
      minIntervalMs: 60_000,
    });

    const provider = {
      id: "openai",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [{ accounting: TEST_ACCOUNTING, name: "OpenAI Pro", percentRemaining: 88 }],
        errors: [],
      }),
    };
    mocks.getProviders.mockReturnValue([provider]);

    let resolveSessionA: ((value: any) => void) | undefined;
    let resolveSessionB: ((value: any) => void) | undefined;
    mocks.fetchSessionTokensForDisplay.mockImplementation(
      ({ sessionID }: { sessionID: string }) =>
        new Promise((resolve) => {
          if (sessionID === "session-a") {
            resolveSessionA = resolve;
            return;
          }
          if (sessionID === "session-b") {
            resolveSessionB = resolve;
            return;
          }
          resolve({ sessionTokens: undefined, error: undefined });
        }),
    );

    const client = createClient({ modelID: "openai/gpt-5", providerID: "openai" });

    const firstRun = buildDialogOutput({ client, sessionID: "session-a" });
    const secondRun = buildDialogOutput({ client, sessionID: "session-b" });

    for (let attempt = 0; attempt < 20; attempt++) {
      if (
        mocks.fetchSessionTokensForDisplay.mock.calls.length === 2 &&
        typeof resolveSessionA === "function" &&
        typeof resolveSessionB === "function"
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(mocks.fetchSessionTokensForDisplay).toHaveBeenCalledTimes(2);
    expect(resolveSessionA).toBeTypeOf("function");
    expect(resolveSessionB).toBeTypeOf("function");

    resolveSessionB?.({
      sessionTokens: {
        models: [{ modelID: "session-b-model", input: 222, output: 22 }],
        totalInput: 222,
        totalOutput: 22,
      },
      error: undefined,
    });
    resolveSessionA?.({
      sessionTokens: {
        models: [{ modelID: "session-a-model", input: 111, output: 11 }],
        totalInput: 111,
        totalOutput: 11,
      },
      error: undefined,
    });

    const sessionBOutput = await secondRun;
    const sessionAOutput = await firstRun;

    expect(sessionAOutput).toContain("session-a-model");
    expect(sessionAOutput).not.toContain("session-b-model");
    expect(sessionBOutput).toContain("session-b-model");
    expect(sessionBOutput).not.toContain("session-a-model");
  });

  it("keeps alibaba local request-plan quota live across repeated /quota commands", async () => {
    const provider = {
      id: "alibaba-coding-plan",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi
        .fn()
        .mockResolvedValueOnce({
          attempted: true,
          entries: [
            {
              accounting: TEST_ACCOUNTING,
              name: "Alibaba Coding Plan (Lite) Weekly",
              percentRemaining: 70,
            },
          ],
          errors: [],
        })
        .mockResolvedValueOnce({
          attempted: true,
          entries: [
            {
              accounting: TEST_ACCOUNTING,
              name: "Alibaba Coding Plan (Lite) Weekly",
              percentRemaining: 60,
            },
          ],
          errors: [],
        }),
    };
    mocks.getProviders.mockReturnValue([provider]);
    mocks.resolveAlibabaCodingPlanAuthCached.mockResolvedValue({
      state: "configured",
      apiKey: "dashscope-key",
      tier: "lite",
    });

    const client = createClient({ modelID: "alibaba/qwen3-coder-plus" });

    await buildDialogOutput({ client, sessionID: "session-alibaba" });
    const latest = await buildDialogOutput({ client, sessionID: "session-alibaba" });

    expect(provider.fetch).toHaveBeenCalledTimes(2);
    expect(latest).toContain("60% left");
  });

  it("keeps cursor local usage live across repeated /quota commands", async () => {
    const provider = {
      id: "cursor",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi
        .fn()
        .mockResolvedValueOnce({
          attempted: true,
          entries: [
            { accounting: TEST_ACCOUNTING, name: "Cursor API (Pro)", percentRemaining: 95 },
          ],
          errors: [],
        })
        .mockResolvedValueOnce({
          attempted: true,
          entries: [
            { accounting: TEST_ACCOUNTING, name: "Cursor API (Pro)", percentRemaining: 90 },
          ],
          errors: [],
        }),
    };
    mocks.getProviders.mockReturnValue([provider]);

    const client = createClient({ modelID: "auto", providerID: "cursor" });

    await buildDialogOutput({ client, sessionID: "session-cursor" });
    const latest = await buildDialogOutput({ client, sessionID: "session-cursor" });

    expect(provider.fetch).toHaveBeenCalledTimes(2);
    expect(latest).toContain("90% left");
  });
});
