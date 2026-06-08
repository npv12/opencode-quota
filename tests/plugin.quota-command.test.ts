import { rm } from "fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMMAND_HANDLED_SENTINEL } from "../src/lib/command-handled.js";
import { DEFAULT_CONFIG } from "../src/lib/types.js";
import {
  createAlibabaAuthModuleMock,
  createConfigModuleMock,
  createPluginRuntimePathsMockModule,
  createPluginTestClient as createClient,
  createPluginToolMockModule,
  createPricingModuleMock,
  createProvidersRegistryModuleMock,
  createQwenAuthModuleMock,
  getPromptText,
  getToastMessage,
  seedDefaultPluginBootstrapMocks,
} from "./helpers/plugin-test-harness.js";

const TEST_RUNTIME_ROOT = "/tmp/opencode-quota-plugin-quota-command-tests";

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
  resolveQwenLocalPlanCached: vi.fn(),
  resolveAlibabaCodingPlanAuthCached: vi.fn(),
}));

vi.mock("@opencode-ai/plugin", () => createPluginToolMockModule());

vi.mock("../src/lib/config.js", () => createConfigModuleMock(mocks.loadConfig));

vi.mock("../src/providers/registry.js", () =>
  createProvidersRegistryModuleMock(mocks.getProviders),
);

vi.mock("../src/lib/modelsdev-pricing.js", () => createPricingModuleMock(mocks));

vi.mock("../src/lib/qwen-auth.js", () =>
  createQwenAuthModuleMock(mocks.resolveQwenLocalPlanCached),
);

vi.mock("../src/lib/alibaba-auth.js", () =>
  createAlibabaAuthModuleMock(mocks.resolveAlibabaCodingPlanAuthCached),
);

vi.mock("../src/lib/opencode-runtime-paths.js", () =>
  createPluginRuntimePathsMockModule(TEST_RUNTIME_ROOT),
);

describe("quota plugin behavior (idle, config, pricing_refresh)", () => {
  let savedConfigDir: string | undefined;

  beforeEach(async () => {
    savedConfigDir = process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG_DIR;
    seedDefaultPluginBootstrapMocks(mocks, {
      configOverrides: {
        enabled: true,
        showOnQuestion: false,

        minIntervalMs: 60_000,
      },
      resetPluginState: true,
    });
    await rm(TEST_RUNTIME_ROOT, { recursive: true, force: true });
    const { __resetQuotaStateForTests } = await import("../src/lib/quota-state.js");
    __resetQuotaStateForTests();
  });

  afterEach(async () => {
    if (savedConfigDir !== undefined) process.env.OPENCODE_CONFIG_DIR = savedConfigDir;
    else delete process.env.OPENCODE_CONFIG_DIR;
    const { __resetQuotaStateForTests } = await import("../src/lib/quota-state.js");
    __resetQuotaStateForTests();
    await rm(TEST_RUNTIME_ROOT, { recursive: true, force: true });
  });

  it("loads config before honoring the first session.idle trigger", async () => {
    mocks.loadConfig.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      enabled: true,
      showOnIdle: false,
      showOnCompact: false,
      showOnQuestion: false,
      minIntervalMs: 60_000,
    });

    const { QuotaToastPlugin } = await import("../src/plugin.js");
    const client = createClient();

    const hooks = await QuotaToastPlugin({ client } as any);

    await hooks.event?.({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-idle" },
      },
    } as any);

    expect(mocks.loadConfig).toHaveBeenCalledTimes(1);
    expect(client.tui.showToast).not.toHaveBeenCalled();
    expect(mocks.maybeRefreshPricingSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "init",
        snapshotSelection: DEFAULT_CONFIG.pricingSnapshot.source,
      }),
    );
  });

  it("shows explicit provider availability errors in idle-triggered toasts", async () => {
    mocks.loadConfig.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      enabled: true,
      enableToast: true,
      enabledProviders: ["copilot"],
      showOnIdle: true,
      showOnCompact: false,
      showOnQuestion: false,
      minIntervalMs: 60_000,
    });

    const provider = {
      id: "copilot",
      isAvailable: vi.fn().mockRejectedValue(new Error("boom")),
      fetch: vi.fn(),
    };
    mocks.getProviders.mockReturnValue([provider]);

    const { QuotaToastPlugin } = await import("../src/plugin.js");
    const client = createClient();
    const hooks = await QuotaToastPlugin({ client } as any);

    await hooks.event?.({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-idle-explicit-provider" },
      },
    } as any);

    expect(provider.fetch).not.toHaveBeenCalled();
    expect(client.tui.showToast).toHaveBeenCalledTimes(1);
    const message = getToastMessage(client);
    expect(message).toContain("Copilot: Unavailable (not detected)");
  });

  it("shows explicit current-model skip errors in idle-triggered toasts", async () => {
    mocks.loadConfig.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      enabled: true,
      enableToast: true,
      enabledProviders: ["openai"],
      onlyCurrentModel: true,
      showOnIdle: true,
      showOnCompact: false,
      showOnQuestion: false,
      minIntervalMs: 60_000,
    });

    const provider = {
      id: "openai",
      matchesCurrentModel: vi.fn().mockReturnValue(false),
      isAvailable: vi.fn(),
      fetch: vi.fn(),
    };
    mocks.getProviders.mockReturnValue([provider]);

    const { QuotaToastPlugin } = await import("../src/plugin.js");
    const client = createClient({
      modelID: "claude-3.7-sonnet",
      providerID: "anthropic",
    });
    const hooks = await QuotaToastPlugin({ client } as any);

    await hooks.event?.({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-idle-model-filter" },
      },
    } as any);

    expect(provider.isAvailable).not.toHaveBeenCalled();
    expect(provider.fetch).not.toHaveBeenCalled();
    expect(client.tui.showToast).toHaveBeenCalledTimes(1);
    const message = getToastMessage(client);
    expect(message).toContain("OpenAI: Skipped (current model: claude-3.7-sonnet)");
  });

  it("applies percentDisplayMode to idle-triggered toast output", async () => {
    mocks.loadConfig.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      enabled: true,
      enableToast: true,
      enabledProviders: ["copilot"],
      showOnIdle: true,
      showOnCompact: false,
      showOnQuestion: false,
      percentDisplayMode: "used",
      minIntervalMs: 60_000,
    });

    const provider = {
      id: "copilot",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockResolvedValue({
        attempted: true,
        entries: [
          {
            name: "Copilot",
            percentRemaining: 81,
            resetTimeIso: "2099-01-01T00:00:00.000Z",
          },
        ],
        errors: [],
      }),
    };
    mocks.getProviders.mockReturnValue([provider]);

    const { QuotaToastPlugin } = await import("../src/plugin.js");
    const client = createClient();
    const hooks = await QuotaToastPlugin({ client } as any);

    await hooks.event?.({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-idle-percent-display" },
      },
    } as any);

    expect(client.tui.showToast).toHaveBeenCalledTimes(1);
    const message = getToastMessage(client);
    expect(message).toContain("19% used");
    expect(message).not.toContain("81% left");
  });

  it("rewrites default_agent only when one zero-width-normalized key matches", async () => {
    const { QuotaToastPlugin } = await import("../src/plugin.js");
    const hooks = await QuotaToastPlugin({ client: createClient() } as any);

    const uniqueMatch = {
      agent: {
        "\u200Bplanner": {},
        coder: {},
      },
      default_agent: "planner",
    };

    await hooks.config?.(uniqueMatch as any);
    expect(uniqueMatch.default_agent).toBe("\u200Bplanner");

    const ambiguousMatch = {
      agent: {
        "\u200Bplanner": {},
        "\u200Cplanner": {},
      },
      default_agent: "planner",
    };

    await hooks.config?.(ambiguousMatch as any);
    expect(ambiguousMatch.default_agent).toBe("planner");
  });

  it("retries a toast provider fetch failure on a deferred timer with provider cache bypass", async () => {
    vi.useFakeTimers();
    try {
      mocks.loadConfig.mockResolvedValueOnce({
        ...DEFAULT_CONFIG,
        enabled: true,
        enableToast: true,
        enabledProviders: ["openai"],
        showOnIdle: true,
        showOnCompact: false,
        showOnQuestion: false,

        minIntervalMs: 60_000,
      });

      const provider = {
        id: "openai",
        isAvailable: vi.fn().mockResolvedValue(true),
        fetch: vi
          .fn()
          .mockRejectedValueOnce(new Error("firewall warming up"))
          .mockResolvedValueOnce({
            attempted: true,
            entries: [{ name: "OpenAI Pro", percentRemaining: 72 }],
            errors: [],
          }),
      };
      mocks.getProviders.mockReturnValue([provider]);

      const { QuotaToastPlugin } = await import("../src/plugin.js");
      const client = createClient({ modelID: "openai/gpt-5", providerID: "openai" });
      const hooks = await QuotaToastPlugin({ client } as any);

      await hooks.event?.({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-deferred-retry" },
        },
      } as any);

      expect(provider.fetch).toHaveBeenCalledTimes(1);
      expect(client.tui.showToast).toHaveBeenCalledTimes(1);
      expect(getToastMessage(client, 0)).toContain("OpenAI: Failed to read quota data");

      await vi.advanceTimersByTimeAsync(3_000);

      expect(provider.fetch).toHaveBeenCalledTimes(2);
      expect(client.tui.showToast).toHaveBeenCalledTimes(2);
      expect(getToastMessage(client, 1)).toContain("72% left");
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a suppressed toast provider fetch failure when showOnBothFail is false", async () => {
    vi.useFakeTimers();
    try {
      mocks.loadConfig.mockResolvedValueOnce({
        ...DEFAULT_CONFIG,
        enabled: true,
        enableToast: true,
        enabledProviders: ["openai"],
        showOnIdle: true,
        showOnCompact: false,
        showOnQuestion: false,
        showOnBothFail: false,

        minIntervalMs: 60_000,
      });

      const provider = {
        id: "openai",
        isAvailable: vi.fn().mockResolvedValue(true),
        fetch: vi
          .fn()
          .mockRejectedValueOnce(new Error("startup network unavailable"))
          .mockResolvedValueOnce({
            attempted: true,
            entries: [{ name: "OpenAI Pro", percentRemaining: 61 }],
            errors: [],
          }),
      };
      mocks.getProviders.mockReturnValue([provider]);

      const { QuotaToastPlugin } = await import("../src/plugin.js");
      const client = createClient({ modelID: "openai/gpt-5", providerID: "openai" });
      const hooks = await QuotaToastPlugin({ client } as any);

      await hooks.event?.({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-deferred-suppressed-error" },
        },
      } as any);

      expect(provider.fetch).toHaveBeenCalledTimes(1);
      expect(client.tui.showToast).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(3_000);

      expect(provider.fetch).toHaveBeenCalledTimes(2);
      expect(client.tui.showToast).toHaveBeenCalledTimes(1);
      expect(getToastMessage(client)).toContain("61% left");
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries an explicit provider availability exception on a deferred timer", async () => {
    vi.useFakeTimers();
    try {
      mocks.loadConfig.mockResolvedValueOnce({
        ...DEFAULT_CONFIG,
        enabled: true,
        enableToast: true,
        enabledProviders: ["openai"],
        showOnIdle: true,
        showOnCompact: false,
        showOnQuestion: false,

        minIntervalMs: 60_000,
      });

      const provider = {
        id: "openai",
        isAvailable: vi
          .fn()
          .mockRejectedValueOnce(new Error("OpenCode auth not readable yet"))
          .mockResolvedValue(true),
        fetch: vi.fn().mockResolvedValue({
          attempted: true,
          entries: [{ name: "OpenAI Pro", percentRemaining: 58 }],
          errors: [],
        }),
      };
      mocks.getProviders.mockReturnValue([provider]);

      const { QuotaToastPlugin } = await import("../src/plugin.js");
      const client = createClient({ modelID: "openai/gpt-5", providerID: "openai" });
      const hooks = await QuotaToastPlugin({ client } as any);

      await hooks.event?.({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-deferred-availability" },
        },
      } as any);

      expect(provider.isAvailable).toHaveBeenCalledTimes(1);
      expect(provider.fetch).not.toHaveBeenCalled();
      expect(client.tui.showToast).toHaveBeenCalledTimes(1);
      expect(getToastMessage(client, 0)).toContain("OpenAI: Unavailable (not detected)");

      await vi.advanceTimersByTimeAsync(3_000);

      expect(provider.isAvailable).toHaveBeenCalledTimes(2);
      expect(provider.fetch).toHaveBeenCalledTimes(1);
      expect(client.tui.showToast).toHaveBeenCalledTimes(2);
      expect(getToastMessage(client, 1)).toContain("58% left");
    } finally {
      vi.useRealTimers();
    }
  });

  it("consumes a pending deferred retry immediately on the next lifecycle toast", async () => {
    mocks.loadConfig.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      enabled: true,
      enableToast: true,
      enabledProviders: ["openai"],
      showOnIdle: true,
      showOnCompact: true,
      showOnQuestion: false,
      minIntervalMs: 60_000,
    });

    const provider = {
      id: "openai",
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi
        .fn()
        .mockRejectedValueOnce(new Error("opencode unavailable"))
        .mockResolvedValueOnce({
          attempted: true,
          entries: [{ name: "OpenAI Pro", percentRemaining: 66 }],
          errors: [],
        }),
    };
    mocks.getProviders.mockReturnValue([provider]);

    const { QuotaToastPlugin } = await import("../src/plugin.js");
    const client = createClient({ modelID: "openai/gpt-5", providerID: "openai" });
    const hooks = await QuotaToastPlugin({ client } as any);

    await hooks.event?.({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-deferred-lifecycle" },
      },
    } as any);
    await hooks.event?.({
      event: {
        type: "session.compacted",
        properties: { sessionID: "session-deferred-lifecycle" },
      },
    } as any);

    expect(provider.fetch).toHaveBeenCalledTimes(2);
    expect(client.tui.showToast).toHaveBeenCalledTimes(2);
    expect(getToastMessage(client, 1)).toContain("66% left");
  });

  it("keys toast throttling by session render context so sessions do not share cached output", async () => {
    mocks.loadConfig.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      enabled: true,
      enableToast: true,
      onlyCurrentModel: true,
      showOnIdle: true,
      showOnCompact: false,
      showOnQuestion: false,
      minIntervalMs: 60_000,
    });

    const provider = {
      id: "openai",
      matchesCurrentModel: vi.fn(() => true),
      isAvailable: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockImplementation(async ({ config }: any) => ({
        attempted: true,
        entries: [{ name: config.currentModel ?? "unknown-model", percentRemaining: 95 }],
        errors: [],
      })),
    };
    mocks.getProviders.mockReturnValue([provider]);

    const { QuotaToastPlugin } = await import("../src/plugin.js");
    const client = createClient();
    client.session.get = vi.fn().mockImplementation(async ({ path }: any) => {
      if (path.id === "session-a") {
        return { data: { modelID: "openai/gpt-5", providerID: "openai" } };
      }
      return { data: { modelID: "openai/gpt-4.1", providerID: "openai" } };
    });

    const hooks = await QuotaToastPlugin({ client } as any);

    await hooks.event?.({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-a" },
      },
    } as any);
    await hooks.event?.({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-b" },
      },
    } as any);

    expect(provider.fetch).toHaveBeenCalledTimes(2);
    expect(getToastMessage(client, 0)).toContain("openai/gpt-5");
    expect(getToastMessage(client, 1)).toContain("openai/gpt-4.1");
    expect(getToastMessage(client, 0)).not.toContain("openai/gpt-4.1");
    expect(getToastMessage(client, 1)).not.toContain("openai/gpt-5");
  });
});
