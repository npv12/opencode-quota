import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeIntegration } from "./helpers/fake-integration.js";
import {
  createConfigModuleMock,
  createPluginRuntimePathsMockModule,
  createPricingModuleMock,
  createProvidersRegistryModuleMock,
  makeQuotaToastTestConfig,
  seedDefaultPluginBootstrapMocks,
} from "./helpers/plugin-test-harness.js";
import { createProviderAvailabilityContext } from "./helpers/provider-test-harness.js";

const TEST_RUNTIME_ROOT = "/tmp/opencode-quota-opencode-go-surfaces";
const TEST_TOKEN = "distinctive-opencode-go-surface-token";

let provider: typeof import("../src/providers/opencode-go.js")["opencodeGoProvider"];
let unbindCredentialSource: (() => void) | undefined;

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  getProviders: vi.fn(),
  getPricingSnapshotMeta: vi.fn(),
  getPricingSnapshotSource: vi.fn(),
  getRuntimePricingRefreshStatePath: vi.fn(),
  getRuntimePricingSnapshotPath: vi.fn(),
  maybeRefreshPricingSnapshot: vi.fn(),
  setPricingSnapshotAutoRefresh: vi.fn(),
  setPricingSnapshotSelection: vi.fn(),
  resolveOpenCodeGoAuthCached: vi.fn(),
  getOpenCodeGoAuthDiagnostics: vi.fn(),
  queryOpenCodeGoQuota: vi.fn(),
}));

vi.mock("../src/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/config.js")>()),
  ...createConfigModuleMock(mocks.loadConfig),
}));
vi.mock("../src/providers/registry.js", () =>
  createProvidersRegistryModuleMock(mocks.getProviders),
);
vi.mock("../src/lib/modelsdev-pricing.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/modelsdev-pricing.js")>()),
  ...createPricingModuleMock(mocks),
}));
vi.mock("../src/lib/opencode-runtime-paths.js", () =>
  createPluginRuntimePathsMockModule(TEST_RUNTIME_ROOT),
);
vi.mock("../src/lib/opencode-go-auth.js", () => ({
  DEFAULT_OPENCODE_GO_AUTH_CACHE_MAX_AGE_MS: 5_000,
  OPENCODE_GO_CREDENTIAL_INTEGRATION_IDS: ["opencode-go", "opencode"],
  resolveOpenCodeGoAuthCached: mocks.resolveOpenCodeGoAuthCached,
  getOpenCodeGoAuthDiagnostics: mocks.getOpenCodeGoAuthDiagnostics,
}));
vi.mock("../src/lib/opencode-go.js", () => ({
  queryOpenCodeGoQuota: mocks.queryOpenCodeGoQuota,
}));

function createConfig() {
  return makeQuotaToastTestConfig({
    enabled: true,
    enabledProviders: ["opencode-go"],
    formatStyle: "allWindows",
    minIntervalMs: 60_000,
    onlyCurrentModel: false,
    showSessionTokens: false,
    telemetry: { enabled: false },
    tuiCommandDisplay: "dialog",
    tuiSidebarPanel: { enabled: true },
  });
}

function successfulResult() {
  return {
    success: true as const,
    rolling: {
      status: "ok" as const,
      usagePercent: 12,
      percentRemaining: 88,
      resetTimeIso: "2026-08-12T12:30:00.000Z",
    },
    weekly: {
      status: "ok" as const,
      usagePercent: 45,
      percentRemaining: 55,
      resetTimeIso: "2026-08-16T16:00:00.000Z",
    },
    monthly: {
      status: "ok" as const,
      usagePercent: 80,
      percentRemaining: 20,
      resetTimeIso: "2026-09-01T04:00:00.000Z",
    },
  };
}

async function bindFakeIntegration(
  integration: ReturnType<typeof createFakeIntegration>,
): Promise<void> {
  const { bindCredentialSource, createIntegrationCredentialSource, notifyCredentialsChanged } =
    await import("../src/lib/opencode-auth.js");
  unbindCredentialSource = bindCredentialSource(
    createIntegrationCredentialSource(integration as never),
  );
  notifyCredentialsChanged();
}

async function collectQuotaProjection(): Promise<string> {
  const { collectQuotaRenderData } = await import("../src/lib/quota-render-data.js");
  const result = await collectQuotaRenderData({
    client: {} as never,
    config: createConfig(),
    providers: [provider],
    formatStyle: "allWindows",
    surfaceExplicitProviderIssues: true,
    bypassProviderCache: true,
  });
  return JSON.stringify(result.data);
}

function expectCanonicalPercentOrder(output: string): void {
  expect(output).toContain("OpenCode Go");
  const positions = [
    output.lastIndexOf('"percentRemaining":88'),
    output.lastIndexOf('"percentRemaining":55'),
    output.lastIndexOf('"percentRemaining":20'),
  ];
  expect(
    positions.every((position) => position >= 0),
    output,
  ).toBe(true);
  expect(positions, output).toEqual([...positions].sort((left, right) => left - right));
}

describe("OpenCode Go shared projections", () => {
  beforeEach(async () => {
    const config = createConfig();
    seedDefaultPluginBootstrapMocks(mocks, {
      configOverrides: config,
      resetPluginState: true,
    });
    const providerModule = await import("../src/providers/opencode-go.js");
    providerModule.__resetOpenCodeGoNotSubscribedForTests();
    provider = providerModule.opencodeGoProvider;
    provider.cachePolicy = {
      kind: "resolved-auth",
      async resolveIdentity() {
        return "opencode-go-test-identity" as never;
      },
    };
    mocks.loadConfig.mockResolvedValue(config);
    mocks.getProviders.mockReturnValue([provider]);
    mocks.resolveOpenCodeGoAuthCached.mockResolvedValue({
      state: "configured",
      apiKey: TEST_TOKEN,
    });
    mocks.getOpenCodeGoAuthDiagnostics.mockResolvedValue({
      state: "configured",
      source: "opencode.db",
      checkedPaths: ["env:OPENCODE_API_KEY"],
      credentialDatabasePaths: ["/tmp/opencode.db"],
    });
    mocks.queryOpenCodeGoQuota.mockResolvedValue(successfulResult());

    await rm(TEST_RUNTIME_ROOT, { recursive: true, force: true });
    const { __resetQuotaStateForTests } = await import("../src/lib/quota-state.js");
    __resetQuotaStateForTests();
    await bindFakeIntegration(createFakeIntegration([]));
  });

  afterEach(async () => {
    unbindCredentialSource?.();
    unbindCredentialSource = undefined;
    const { __resetQuotaStateForTests } = await import("../src/lib/quota-state.js");
    __resetQuotaStateForTests();
    await rm(TEST_RUNTIME_ROOT, { recursive: true, force: true });
  });

  it("keeps canonical all-window values in the projection", async () => {
    const output = await collectQuotaProjection();
    expectCanonicalPercentOrder(output);
    expect(output).not.toContain(TEST_TOKEN);
  });

  it("uses the Go key and keeps the console error when the console sign-in cannot be refreshed", async () => {
    const integration = createFakeIntegration([
      {
        integrationId: "opencode",
        id: "cred_console",
        label: "default",
        registered: true,
        method: "oauth",
        value: {
          type: "oauth",
          methodID: "device",
          access: "distinctive-console-access",
          refresh: "distinctive-console-refresh",
          expires: 0,
        },
        resolveError: "HTTP 401",
      },
    ]);
    await bindFakeIntegration(integration);

    const output = await collectQuotaProjection();
    expectCanonicalPercentOrder(output);
    for (const secret of [
      TEST_TOKEN,
      "distinctive-console-access",
      "distinctive-console-refresh",
    ]) {
      expect(output).not.toContain(secret);
    }

    const result = await provider.fetch(createProviderAvailabilityContext());
    expect(result.statusDetails).toEqual(
      expect.arrayContaining([
        { key: "console_auth_state", value: "invalid" },
        { key: "console_error", value: "refresh_failed: HTTP 401" },
        { key: "go_source", value: "legacy_key" },
      ]),
    );
    // The failed sign-in is resolved once, then not again within the minute.
    expect(integration.connection.resolve).toHaveBeenCalledOnce();
  });

  it("shows the failed console sign-in on the projection when there is no Go key", async () => {
    mocks.resolveOpenCodeGoAuthCached.mockResolvedValue({ state: "none" });
    mocks.getOpenCodeGoAuthDiagnostics.mockResolvedValue({
      state: "none",
      source: null,
      checkedPaths: ["env:OPENCODE_API_KEY"],
      credentialDatabasePaths: ["/tmp/opencode.db"],
    });
    const integration = createFakeIntegration([
      {
        integrationId: "opencode",
        id: "cred_console",
        label: "default",
        registered: true,
        method: "oauth",
        value: {
          type: "oauth",
          methodID: "device",
          access: "distinctive-console-access",
          refresh: "distinctive-console-refresh",
          expires: 0,
        },
        resolveError: "HTTP 401",
      },
    ]);
    await bindFakeIntegration(integration);

    const output = await collectQuotaProjection();
    const message =
      "OpenCode Console sign-in failed: refresh_failed: HTTP 401. Run `opencode auth login opencode`.";

    expect(output).toContain(message);
    expect(mocks.queryOpenCodeGoQuota).not.toHaveBeenCalled();
    for (const secret of ["distinctive-console-access", "distinctive-console-refresh"]) {
      expect(output).not.toContain(secret);
    }
  });

  it("hides a not-subscribed result from the projection and keeps it out of the export", async () => {
    mocks.queryOpenCodeGoQuota.mockResolvedValue({
      success: false,
      error: "OpenCode Go not subscribed (403 EntitlementError)",
      notSubscribed: true,
      retryable: false,
    });
    const output = await collectQuotaProjection();
    expect(output).not.toContain("EntitlementError");
    expect(output).not.toContain(TEST_TOKEN);

    const { buildQuotaExport } = await import("../src/lib/quota-export.js");
    const { createRuntimeProviderIdResolver } = await import("../src/lib/runtime-provider-ids.js");
    const exportData = await buildQuotaExport({
      providers: [provider],
      ctx: {
        client: {} as never,
        config: createConfig(),
        resolveRuntimeProviderIds: createRuntimeProviderIdResolver({} as never),
      } as never,
      ttlMs: 60_000,
      fromCache: true,
    });
    expect(exportData.providers["opencode-go"]).toEqual({ status: "unavailable" });

    expect(mocks.queryOpenCodeGoQuota).toHaveBeenCalledTimes(1);
  });

  it("selects the most constrained window and preserves accounting through projection", async () => {
    const config = createConfig();
    const { collectQuotaRenderData } = await import("../src/lib/quota-render-data.js");
    const singleWindow = await collectQuotaRenderData({
      client: {} as never,
      config,
      providers: [provider],
      formatStyle: "singleWindow",
      surfaceExplicitProviderIssues: true,
      bypassProviderCache: true,
    });
    const allWindows = await collectQuotaRenderData({
      client: {} as never,
      config,
      providers: [provider],
      formatStyle: "allWindows",
      surfaceExplicitProviderIssues: true,
      bypassProviderCache: true,
    });

    expect(allWindows.data?.entries.map((entry) => entry.name)).toEqual([
      "OpenCode Go 5h",
      "OpenCode Go Weekly",
      "OpenCode Go Monthly",
    ]);
    expect(singleWindow.data?.entries).toHaveLength(1);
    expect(singleWindow.data?.entries[0]).toMatchObject({
      name: "[OpenCode Go] Monthly",
      percentRemaining: 20,
      accounting: {
        resultType: "quota",
        acquisitionMethod: "remote_api",
        ownership: "maintained",
        authority: "provider_reported",
      },
    });
  });

  it("includes the selected Go windows in the provider cache identity", async () => {
    const { buildQuotaProviderStateCacheKey } = await import("../src/lib/quota-state.js");
    const rolling = createProviderAvailabilityContext({
      configOverrides: { opencodeGoWindows: ["rolling"] },
    });
    const monthly = createProviderAvailabilityContext({
      configOverrides: { opencodeGoWindows: ["monthly"] },
    });

    const rollingKey = buildQuotaProviderStateCacheKey("opencode-go", rolling);
    const monthlyKey = buildQuotaProviderStateCacheKey("opencode-go", monthly);

    expect(rollingKey).toContain("opencodeGoWindows=rolling");
    expect(monthlyKey).toContain("opencodeGoWindows=monthly");
    expect(rollingKey).not.toBe(monthlyKey);
    expect(rollingKey).not.toContain(TEST_TOKEN);
    expect(monthlyKey).not.toContain(TEST_TOKEN);
  });
});
