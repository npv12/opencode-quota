import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertPhase5CanariesRedacted,
  assertPhase5FixtureOrder,
  PHASE5_ACCOUNTING_RESPONSE,
  PHASE5_OPENROUTER_RESPONSE,
  PHASE5_QUOTA_PROVIDERS,
  PHASE5_RUNTIME_PROVIDER_IDS,
  PHASE5_SECRET_CANARIES,
  phase5JsonResponse,
} from "./fixtures/v4-phase5-integration.js";
import { createFakeIntegration } from "./helpers/fake-integration.js";
import {
  createAlibabaAuthModuleMock,
  createConfigModuleMock,
  createPluginRuntimePathsMockModule,
  createPluginTestClient,
  createPricingModuleMock,
  createProvidersRegistryModuleMock,
  createSessionTokensModuleMock,
  makeQuotaToastTestConfig,
  seedDefaultPluginBootstrapMocks,
} from "./helpers/plugin-test-harness.js";
import { createQuotaRpcBridge } from "./helpers/quota-rpc-bridge.js";

const TEST_RUNTIME_ROOT = "/tmp/opencode-quota-v4-phase5-cross-surface";
const POSIX_IDENTITY_STORAGE = process.platform !== "win32" && typeof process.getuid === "function";
const MINIMAX_QUOTA_URL = "https://api.minimax.io/v1/api/openplatform/coding_plan/remains";
const MINIMAX_CHINA_QUOTA_URL = "https://api.minimaxi.com/v1/token_plan/remains";
const MINIMAX_API_KEY = "minimax-test-key";
const MINIMAX_CHINA_API_KEY = "minimax-china-test-key";

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
  resolveAlibabaCodingPlanAuthCached: vi.fn(),
  resolveMiniMaxAuthCached: vi.fn(),
  getMiniMaxAuthDiagnostics: vi.fn(),
  resolveMiniMaxChinaAuthCached: vi.fn(),
  getMiniMaxChinaAuthDiagnostics: vi.fn(),
  getAnthropicDiagnostics: vi.fn(),
  hasAnthropicCredentialsConfigured: vi.fn(),
  queryAnthropicQuota: vi.fn(),
  fetchSessionTokensForDisplay: vi.fn(),
}));

const otel = vi.hoisted(() => {
  const callbacks = new Map<
    string,
    (result: { observe(value: number, attributes?: Record<string, unknown>): void }) => void
  >();
  return {
    callbacks,
    getMeter: vi.fn(() => ({
      createObservableGauge: vi.fn((name: string) => ({
        addCallback: (
          callback: (result: {
            observe(value: number, attributes?: Record<string, unknown>): void;
          }) => void,
        ) => callbacks.set(name, callback),
        removeCallback: () => callbacks.delete(name),
      })),
    })),
  };
});

vi.mock("@opentui/solid", () => ({
  useTerminalDimensions: () => () => ({ width: 120, height: 40 }),
}));

vi.mock("@opentelemetry/api", () => ({
  metrics: { getMeter: otel.getMeter },
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
vi.mock("../src/lib/session-tokens.js", () =>
  createSessionTokensModuleMock(mocks.fetchSessionTokensForDisplay),
);
vi.mock("../src/lib/alibaba-auth.js", () =>
  createAlibabaAuthModuleMock(mocks.resolveAlibabaCodingPlanAuthCached),
);
vi.mock("../src/lib/minimax-auth.js", () => ({
  resolveMiniMaxAuth: vi.fn(),
  resolveMiniMaxChinaAuth: vi.fn(),
  DEFAULT_MINIMAX_AUTH_CACHE_MAX_AGE_MS: 5_000,
  resolveMiniMaxAuthCached: mocks.resolveMiniMaxAuthCached,
  getMiniMaxAuthDiagnostics: mocks.getMiniMaxAuthDiagnostics,
  resolveMiniMaxChinaAuthCached: mocks.resolveMiniMaxChinaAuthCached,
  getMiniMaxChinaAuthDiagnostics: mocks.getMiniMaxChinaAuthDiagnostics,
}));
vi.mock("../src/lib/anthropic.js", () => ({
  getAnthropicDiagnostics: mocks.getAnthropicDiagnostics,
  hasAnthropicCredentialsConfigured: mocks.hasAnthropicCredentialsConfigured,
  queryAnthropicQuota: mocks.queryAnthropicQuota,
}));
vi.mock("../src/lib/opencode-runtime-paths.js", () =>
  createPluginRuntimePathsMockModule(TEST_RUNTIME_ROOT),
);

const renderedSidebar = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock("../src/lib/tui-sidebar-format.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/tui-sidebar-format.js")>();
  return {
    ...actual,
    buildSidebarQuotaPanelLines: (
      params: Parameters<typeof actual.buildSidebarQuotaPanelLines>[0],
    ) => {
      const lines = actual.buildSidebarQuotaPanelLines(params);
      renderedSidebar.lines.push(lines.join("\n"));
      return lines;
    },
  };
});

type RegisteredTool = {
  name: string;
  execute(input: object, context: { sessionID: string }): Promise<{ content: string }>;
};

async function setupV2Surfaces(client: ReturnType<typeof createClient>, providerIds: string[]) {
  let tool: RegisteredTool | undefined;
  const { default: serverPlugin } = await import("../src/plugin.js");
  const register = vi.fn(async () => ({ dispose: async () => {}, events: { emit: vi.fn() } }));
  await serverPlugin.setup({
    location: { directory: process.cwd() },
    provider: { list: vi.fn(async () => ({ data: providerIds.map((id) => ({ id })) })) },
    session: {
      get: vi.fn(async () => ({ model: { id: "model-one", providerID: providerIds[0] } })),
      hook: vi.fn(),
    },
    command: { transform: vi.fn() },
    rpc: { register },
    integration: createFakeIntegration([]),
    event: { subscribe: () => ({ async *[Symbol.asyncIterator]() {} }) },
    tool: {
      transform: vi.fn(async (callback: (editor: { add(value: RegisteredTool): void }) => void) => {
        callback({
          add: (value) => {
            tool = value;
          },
        });
      }),
    },
  } as never);
  expect(tool).toBeUndefined();
  // The TUI computes nothing itself: every surface reaches the server's RPC handlers.
  const [, handlers] = register.mock.calls[0] as unknown as [
    unknown,
    Parameters<typeof createQuotaRpcBridge>[0],
  ];

  const events = new Map<string, Set<(event: { data: { sessionID: string } }) => void>>();
  let commands: Array<{ id: string; run: () => Promise<void> }> = [];
  // The Enter binding that runs a quota command typed in the TUI prompt.
  let enter: (() => unknown) | undefined;
  const editor = { plainText: "", clear: vi.fn() };
  // Records the title, subtitle, and scrollbox text of each quota output dialog the TUI
  // shows. The scrollbox text is every text node in order, one per line, without the blank
  // rows; a text node made of spans is their text joined.
  const dialog = vi.fn((_input: { title: string; subtitle?: string; message: string }) => {});
  type Node = { type: string; props: Record<string, any> };
  const find = (node: unknown, type: string): Node | undefined => {
    if (Array.isArray(node)) return node.map((child) => find(child, type)).find(Boolean);
    if (!node || typeof node !== "object") return undefined;
    return (node as Node).type === type
      ? (node as Node)
      : find((node as Node).props?.children, type);
  };
  const texts = (node: unknown): string[] => {
    if (Array.isArray(node)) return node.flatMap(texts);
    if (!node || typeof node !== "object") return [];
    if ((node as Node).type !== "text") return texts((node as Node).props?.children);
    const children = (node as Node).props.children;
    return [
      Array.isArray(children)
        ? children.map((span: Node) => span.props.children).join("")
        : children,
    ];
  };
  const show = (render: () => unknown, onClose?: () => void) => {
    const tree = render();
    const title = find(tree, "text")?.props.children;
    const subtitle = (tree as Node).props.children[0].props.children[1]?.props.children;
    const message = texts(find(tree, "scrollbox")).join("\n");
    dialog({ title, subtitle, message });
    onClose?.();
  };
  const toast = vi.fn();
  const slots: string[] = [];
  const renderers = new Map<string, (props?: { sessionID: string }) => unknown>();
  let route: { type: "home" } | { type: "session"; sessionID: string } = { type: "home" };
  vi.stubGlobal("React", {
    createElement: (
      type: unknown,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ) => {
      const all = { ...props, children: children.length > 1 ? children : children[0] };
      return typeof type === "function" ? type(all) : { type, props: all };
    },
  });
  const { default: tuiPlugin } = await import("../src/tui-v2.js");
  const dispose = tuiPlugin.setup({
    client: { ...client, rpc: createQuotaRpcBridge(handlers) },
    location: { directory: process.cwd() },
    renderer: { currentFocusedEditor: editor },
    theme: {
      text: { base: "base", muted: "muted" },
      surface: () => ({
        text: { base: "base", muted: "muted", action: { primary: { focused: "action" } } },
        background: { action: { primary: { focused: "action-bg" } } },
      }),
    },
    data: {
      on: (event: string, callback: (event: { data: { sessionID: string } }) => void) => {
        const callbacks = events.get(event) ?? new Set();
        callbacks.add(callback);
        events.set(event, callbacks);
        return () => callbacks.delete(callback);
      },
      session: { get: () => ({}) },
      location: {
        default: () => ({ directory: process.cwd() }),
        provider: { list: () => providerIds.map((id) => ({ id })) },
      },
    },
    keymap: {
      layer: (build: () => { mode?: string; priority?: number; commands: typeof commands }) => {
        const layer = build();
        if (layer.mode === "global") commands = layer.commands;
        if (layer.priority === 1) enter = layer.commands[0].run;
      },
    },
    ui: {
      slot: (claim: { append: string; render: (props?: { sessionID: string }) => unknown }) => {
        slots.push(claim.append);
        renderers.set(claim.append, claim.render);
        if (claim.append === "app") claim.render();
        return () => {};
      },
      toast: { show: toast },
      router: { current: () => route },
      dialog: { show, clear: vi.fn(), prompt: vi.fn(), set: vi.fn() },
    },
  } as never);
  expect(slots).toContain("app");
  expect(slots).toContain("sidebar.content");
  expect(slots).not.toContain("prompt.footer");
  expect(slots).not.toContain("home.footer.status");
  const quota = commands.find((command) => command.id === "quota.quota");
  expect(quota).toBeDefined();
  expect(commands.some((command) => command.id === "quota.quota_status")).toBe(false);
  return {
    dialog,
    quota: quota!,
    typeCommand: (text: string) => {
      editor.plainText = text;
      return enter!();
    },
    renderSidebar: async (sessionID: string) => {
      renderedSidebar.lines.length = 0;
      renderers.get("sidebar.content")?.({ sessionID });
      await vi.waitFor(() => expect(renderedSidebar.lines).toHaveLength(1));
      return renderedSidebar.lines[0];
    },
    openSession: (sessionID: string) => {
      route = { type: "session", sessionID };
    },
    dispose: dispose as () => void,
  };
}

function configFor(formatStyle: "allWindows" | "singleWindow") {
  return makeQuotaToastTestConfig({
    enabled: true,
    enabledProviders: ["quota-providers"],
    quotaProviders: PHASE5_QUOTA_PROVIDERS.map((source) => ({ ...source })),
    formatStyle,
    minIntervalMs: 60_000,
    showSessionTokens: true,
    sessionTokenScope: "tree",
    telemetry: {
      enabled: true,
    },
    tuiCommandDisplay: "dialog",
    tuiSidebarPanel: {
      enabled: true,
    },
  });
}

function configForSingleProvider(providerId = "minimax-coding-plan") {
  return makeQuotaToastTestConfig({
    enabled: true,
    enabledProviders: [providerId],
    formatStyle: "allWindows",
    minIntervalMs: 60_000,
    showSessionTokens: false,
    telemetry: {
      enabled: false,
    },
    tuiCommandDisplay: "dialog",
    tuiSidebarPanel: {
      enabled: true,
    },
  });
}

function createClient() {
  const client = createPluginTestClient({
    modelID: "team-gateway/model-one",
    providerID: "team-gateway",
  });
  client.config.providers.mockResolvedValue({
    data: {
      providers: PHASE5_RUNTIME_PROVIDER_IDS.map((id) => ({ id })),
    },
  });
  return client;
}

function assertTreeSessionTokenTotals(output: string): void {
  expect(output).toMatch(/1\.2K[^\n]*300[^\n]*45/u);
}

function assertFixtureContent(output: string): void {
  expect(output).toContain("64%");
  expect(output).toContain("$12.34");
  expect(output).toContain("80%");
  expect(output).toContain("adapter.mappings[2]");
  expect(output).toContain("HTTP 503");
  assertPhase5FixtureOrder(output);
  assertPhase5CanariesRedacted(output);
}

describe("v4 Phase 5 cross-surface release evidence", () => {
  let currentConfig = configFor("allWindows");
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    const { __resetQuotaTelemetryForTests } = await import("../src/lib/quota-telemetry.js");
    __resetQuotaTelemetryForTests();
    otel.callbacks.clear();
    otel.getMeter.mockClear();
    savedEnv = {
      PHASE5_TEAM_ACCOUNTING_KEY: process.env.PHASE5_TEAM_ACCOUNTING_KEY,
      PHASE5_OPENROUTER_KEY: process.env.PHASE5_OPENROUTER_KEY,
      PHASE5_FAILING_KEY: process.env.PHASE5_FAILING_KEY,
    };
    process.env.PHASE5_TEAM_ACCOUNTING_KEY = PHASE5_SECRET_CANARIES.accountingKey;
    process.env.PHASE5_OPENROUTER_KEY = PHASE5_SECRET_CANARIES.openRouterKey;
    process.env.PHASE5_FAILING_KEY = PHASE5_SECRET_CANARIES.failingKey;

    currentConfig = configFor("allWindows");
    seedDefaultPluginBootstrapMocks(mocks, {
      configOverrides: currentConfig,
      resetPluginState: true,
    });
    mocks.fetchSessionTokensForDisplay.mockResolvedValue({
      sessionTokens: {
        models: [
          {
            modelID: "tree-model",
            input: 1200,
            cachedInput: 300,
            totalInput: 1500,
            output: 45,
          },
        ],
        totalInput: 1200,
        totalCachedInput: 300,
        totalCombinedInput: 1500,
        totalOutput: 45,
      },
    });
    mocks.loadConfig.mockImplementation(async () => currentConfig);
    mocks.resolveMiniMaxAuthCached.mockResolvedValue({
      state: "configured",
      apiKey: MINIMAX_API_KEY,
      endpoint: "international",
    });
    mocks.getMiniMaxAuthDiagnostics.mockResolvedValue({
      state: "configured",
      source: "opencode.db",
      endpoint: "international",
      checkedPaths: [],
      credentialDatabasePaths: [],
    });
    mocks.resolveMiniMaxChinaAuthCached.mockResolvedValue({ state: "none" });
    mocks.getMiniMaxChinaAuthDiagnostics.mockResolvedValue({
      state: "none",
      source: null,
      checkedPaths: [],
      credentialDatabasePaths: [],
    });

    const { quotaProvidersProvider } = await import("../src/providers/quota-providers.js");
    mocks.getProviders.mockReturnValue([quotaProvidersProvider]);

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("authorization");
      if (url === PHASE5_QUOTA_PROVIDERS[0].url) {
        expect(authorization).toBe(`Bearer ${PHASE5_SECRET_CANARIES.accountingKey}`);
        await new Promise((resolve) => setTimeout(resolve, 8));
        return phase5JsonResponse(PHASE5_ACCOUNTING_RESPONSE);
      }
      if (url === PHASE5_QUOTA_PROVIDERS[1].url) {
        expect(authorization).toBe(`Bearer ${PHASE5_SECRET_CANARIES.openRouterKey}`);
        return phase5JsonResponse(PHASE5_OPENROUTER_RESPONSE);
      }
      if (url === PHASE5_QUOTA_PROVIDERS[2].url) {
        expect(authorization).toBe(`Bearer ${PHASE5_SECRET_CANARIES.failingKey}`);
        await new Promise((resolve) => setTimeout(resolve, 3));
        return new Response(PHASE5_SECRET_CANARIES.failureBody, {
          status: 503,
          headers: { "content-type": "text/plain" },
        });
      }
      if (url === MINIMAX_QUOTA_URL) {
        expect(authorization).toBe(`Bearer ${MINIMAX_API_KEY}`);
        return phase5JsonResponse({
          model_remains: [
            {
              model_name: "MiniMax-M*",
              current_interval_total_count: 100,
              current_interval_usage_count: -5,
              remains_time: 3_600_000,
              current_weekly_total_count: 200,
              current_weekly_usage_count: -20,
              weekly_remains_time: 86_400_000,
            },
          ],
          base_resp: { status_code: 0, status_msg: "success" },
        });
      }
      if (url === MINIMAX_CHINA_QUOTA_URL) {
        expect(authorization).toBe(`Bearer ${MINIMAX_CHINA_API_KEY}`);
        return phase5JsonResponse({
          model_remains: [
            {
              model_name: "general",
              current_interval_total_count: 0,
              current_interval_usage_count: 0,
              remains_time: 3_600_000,
              current_weekly_total_count: 0,
              current_weekly_usage_count: 0,
              weekly_remains_time: 86_400_000,
              current_interval_remaining_percent: 33,
              current_weekly_remaining_percent: 46,
            },
            {
              model_name: "video",
              current_interval_total_count: 100,
              current_interval_usage_count: 99,
              remains_time: 3_600_000,
            },
          ],
          base_resp: { status_code: 0, status_msg: "success" },
        });
      }
      throw new Error(`unexpected Phase 5 fixture URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await rm(TEST_RUNTIME_ROOT, { recursive: true, force: true });
    const { __resetQuotaStateForTests } = await import("../src/lib/quota-state.js");
    __resetQuotaStateForTests();
  });

  afterEach(async () => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    vi.unstubAllGlobals();
    const { __resetQuotaStateForTests } = await import("../src/lib/quota-state.js");
    __resetQuotaStateForTests();
    const { __resetQuotaTelemetryForTests } = await import("../src/lib/quota-telemetry.js");
    __resetQuotaTelemetryForTests();
    await rm(TEST_RUNTIME_ROOT, { recursive: true, force: true });
  });

  it("proves the V2 /quota dialog, sidebar, export, and redaction", async () => {
    const client = createClient();
    const v2 = await setupV2Surfaces(client, PHASE5_RUNTIME_PROVIDER_IDS);
    v2.openSession("phase5-session");
    await v2.quota.run();
    expect(v2.dialog).toHaveBeenCalledOnce();
    expect(client.session.prompt).not.toHaveBeenCalled();
    const quotaDialog = v2.dialog.mock.calls[0][0];
    const serverOutput = quotaDialog.message;
    expect(quotaDialog.title).toBe("OpenCode Quota");
    expect(quotaDialog.subtitle).toMatch(/^\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/);
    expect(serverOutput).toMatch(/^Quota limits\n/);
    expect(serverOutput).not.toContain("(/quota)");
    // /quota typed in the TUI prompt opens the same report in the dialog and posts nothing.
    expect(v2.typeCommand("/quota")).toBeUndefined();
    await vi.waitFor(() => expect(v2.dialog).toHaveBeenCalledTimes(2));
    expect(v2.dialog.mock.calls[1][0]).toMatchObject({
      title: "OpenCode Quota",
      subtitle: quotaDialog.subtitle,
    });
    expect(v2.dialog.mock.calls[1][0].message).toMatch(/^Quota limits\n/);
    expect(client.session.prompt).not.toHaveBeenCalled();
    expect(serverOutput).not.toContain("```");
    expect(serverOutput).not.toMatch(/^#{1,6} /mu);
    // The dialog groups the rows into a quota table and a spending table, each with one
    // header row and the providers as sub-headers. Every bar is 24 cells long.
    expect(serverOutput).toMatch(
      /^Quota limits\nProvider · window +Usage +Left +Used +Resets in\nTeam Accounting\n {2}Month +[█░]{24} +64% +64\/100 +\d+d /u,
    );
    const serverBars = serverOutput.match(/[█░]+/gu) ?? [];
    expect(serverBars.length).toBeGreaterThan(0);
    expect(serverBars.every((bar) => Array.from(bar).length === 24)).toBe(true);
    expect(serverOutput).not.toMatch(/ {2}Month [^\n]* \| /u);
    expect(serverOutput).toMatch(
      /\nSpending & balances\nProvider · item +Amount\nTeam Accounting\n {2}Balance +\$12\.34\n/u,
    );
    assertFixtureContent(serverOutput);
    assertTreeSessionTokenTotals(serverOutput);
    expect(serverOutput).toContain("tree-model");

    const { quotaProvidersProvider } = await import("../src/providers/quota-providers.js");
    const { resolveQuotaRuntimeContext } = await import("../src/lib/quota-runtime-context.js");
    const runtime = await resolveQuotaRuntimeContext({
      client: client as never,
      roots: { workspaceRoot: process.cwd() },
      config: currentConfig,
      providers: [quotaProvidersProvider],
      configureTelemetry: false,
    });
    const { buildQuotaExport, createExportProviderContext } = await import(
      "../src/lib/quota-export.js"
    );
    const exportContext = createExportProviderContext(runtime);
    const { collectQuotaRenderData } = await import("../src/lib/quota-render-data.js");
    // The aggregate's process-local cache is scoped to the client object; the server
    // plugin builds its own client adapter, so prime the export reader's context.
    await collectQuotaRenderData({
      client: runtime.client,
      resolveRuntimeProviderIds: runtime.resolveRuntimeProviderIds,
      config: runtime.config,
      configMeta: runtime.configMeta,
      request: {},
      providers: runtime.providers,
    });
    const fetchCallsBeforeExport = vi.mocked(globalThis.fetch).mock.calls.length;
    const exportData = await buildQuotaExport({
      providers: [quotaProvidersProvider],
      ctx: exportContext,
      ttlMs: currentConfig.minIntervalMs,
      fromCache: true,
    });
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(fetchCallsBeforeExport);
    expect(exportData.version).toBe(2);
    const exportedProvider = exportData.providers["quota-providers"];
    expect(exportedProvider?.status).toBe("partial");
    if (!exportedProvider || !("entries" in exportedProvider)) {
      throw new Error("Expected cached Phase 5 quota-provider export entries");
    }
    expect(exportedProvider.sources).toEqual([
      { id: "team-accounting", providerId: "team-gateway", status: "ok", entryCount: 2 },
      { id: "openrouter-primary", providerId: "openrouter", status: "ok", entryCount: 1 },
      {
        id: "failing-accounting",
        providerId: "failing-gateway",
        status: "error",
        entryCount: 0,
      },
    ]);
    expect(
      exportedProvider.entries.map((entry) =>
        entry.renderType === "percent" ? entry.percentRemaining : entry.value,
      ),
    ).toEqual([64, "$12.34", 80]);
    const exportOutput = JSON.stringify(exportData);
    assertPhase5CanariesRedacted(exportOutput);
    for (const source of PHASE5_QUOTA_PROVIDERS) {
      expect(exportOutput).not.toContain(source.url);
    }
    expect(exportOutput).not.toMatch(/telemetryToken|opencode\.quota\./u);

    const { classifyQuotaWindowText } = await import("../src/lib/quota-entry-display.js");
    const expectedConsumed = new Map<string, number>();
    for (const entry of exportedProvider.entries) {
      if (entry.renderType !== "percent" || !Number.isFinite(entry.percentRemaining)) continue;
      const attributes = {
        "quota.provider": "custom",
        "quota.window": classifyQuotaWindowText(entry.window ?? "") ?? "unknown",
        "quota.result_type": entry.resultType,
      };
      const key = JSON.stringify(attributes);
      const consumed = Math.min(1, Math.max(0, (100 - entry.percentRemaining) / 100));
      expectedConsumed.set(key, Math.max(expectedConsumed.get(key) ?? 0, consumed));
    }

    const sidebarOutput = await v2.renderSidebar("phase5-session");
    expect(sidebarOutput).toContain("64%");
    expect(sidebarOutput).toContain("$12.34");
    expect(sidebarOutput).toContain("80%");
    expect(sidebarOutput).toContain("adapter.mappings[2]");
    expect(sidebarOutput).toContain("HTTP 503");
    const teamIndex = sidebarOutput.indexOf("Team");
    const openRouterIndex = sidebarOutput.indexOf("OpenRout");
    const failingIndex = sidebarOutput.indexOf("Failing");
    expect(openRouterIndex).toBeGreaterThanOrEqual(0);
    expect(teamIndex).toBeGreaterThan(openRouterIndex);
    expect(failingIndex).toBeGreaterThan(teamIndex);
    expect(sidebarOutput).not.toContain("Session input/output tokens");
    assertPhase5CanariesRedacted(sidebarOutput);

    const allOutput = JSON.stringify({ serverOutput, sidebarOutput });
    assertPhase5CanariesRedacted(allOutput);
    for (const source of PHASE5_QUOTA_PROVIDERS) {
      expect(allOutput).not.toContain(source.url);
    }

    const { __flushQuotaTelemetryInitializationForTests } = await import(
      "../src/lib/quota-telemetry.js"
    );
    await __flushQuotaTelemetryInitializationForTests();
    const fetchCallsBeforeMetrics = vi.mocked(globalThis.fetch).mock.calls.length;
    const providerDiscoveryCallsBeforeMetrics = client.config.providers.mock.calls.length;
    const metricObservedAt = Date.now();
    const observations: Array<{
      metric: string;
      value: number;
      attributes?: Record<string, unknown>;
    }> = [];
    for (const [metric, callback] of otel.callbacks) {
      callback({
        observe: (value, attributes) => {
          observations.push({ metric, value, attributes });
        },
      });
    }
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(fetchCallsBeforeMetrics);
    expect(client.config.providers).toHaveBeenCalledTimes(providerDiscoveryCallsBeforeMetrics);
    expect(otel.getMeter).toHaveBeenCalledOnce();
    expect(new Set(observations.map(({ metric }) => metric))).toEqual(
      new Set([
        "opencode.quota.consumed",
        ...(POSIX_IDENTITY_STORAGE ? ["opencode.quota.cache.age"] : []),
      ]),
    );
    const actualConsumed = new Map(
      observations
        .filter(({ metric }) => metric === "opencode.quota.consumed")
        .map(({ attributes, value }) => [JSON.stringify(attributes), value]),
    );
    expect(actualConsumed).toEqual(expectedConsumed);
    expect(
      observations
        .filter(({ metric }) => metric === "opencode.quota.consumed")
        .every(
          ({ attributes }) =>
            attributes?.["quota.provider"] === "custom" &&
            JSON.stringify(Object.keys(attributes).sort()) ===
              JSON.stringify(["quota.provider", "quota.result_type", "quota.window"]),
        ),
    ).toBe(true);
    const cacheAgeObservations = observations.filter(
      ({ metric }) => metric === "opencode.quota.cache.age",
    );
    expect(
      cacheAgeObservations.every(
        ({ attributes }) =>
          JSON.stringify(attributes) === JSON.stringify({ "quota.provider": "custom" }),
      ),
    ).toBe(true);
    expect(cacheAgeObservations).toHaveLength(POSIX_IDENTITY_STORAGE ? 1 : 0);
    if (POSIX_IDENTITY_STORAGE) {
      const oldestFetchedAt = Math.min(
        ...Object.values(exportData.providers)
          .filter((provider) => "fetchedAt" in provider)
          .map((provider) => provider.fetchedAt),
      );
      // fetchedAt is floored to whole seconds (up to 1s off) and the gauge reads Date.now()
      // after metricObservedAt, so slow runs can drift up to 2s.
      expect(
        Math.abs(cacheAgeObservations[0].value - (metricObservedAt / 1000 - oldestFetchedAt)),
      ).toBeLessThanOrEqual(2);
    }
    const telemetryOutput = JSON.stringify(observations);
    assertPhase5CanariesRedacted(telemetryOutput);
    for (const source of PHASE5_QUOTA_PROVIDERS) {
      expect(telemetryOutput).not.toContain(source.id);
      expect(telemetryOutput).not.toContain(source.label);
      expect(telemetryOutput).not.toContain(source.url);
    }
    expect(allOutput).not.toMatch(/telemetryToken|opencode\.quota\./);
    v2.dispose();
  });

  it("keeps over-quota MiniMax results in cache, export, and the sidebar", async () => {
    currentConfig = configForSingleProvider();
    mocks.loadConfig.mockImplementation(async () => currentConfig);
    const { minimaxCodingPlanProvider } = await import("../src/providers/minimax-coding-plan.js");
    minimaxCodingPlanProvider.cachePolicy = { kind: "account-neutral" };
    mocks.getProviders.mockReturnValue([minimaxCodingPlanProvider]);

    const client = createClient();
    client.config.providers.mockResolvedValue({
      data: { providers: [{ id: "minimax-coding-plan" }] },
    });

    const v2 = await setupV2Surfaces(client, ["minimax-coding-plan"]);
    await v2.quota.run();
    const serverOutput = v2.dialog.mock.calls[0][0].message;
    expect(serverOutput).toContain("MiniMax Token Plan");
    expect(serverOutput).toMatch(/\n {2}5h +░{24} +0% /u);
    expect(serverOutput).toMatch(/\n {2}Weekly +░{24} +0% /u);
    expect(serverOutput).toContain("Remaining: -5 requests");
    expect(serverOutput).toContain("Remaining: -20 requests");
    expect(serverOutput).not.toContain("Invalid normalized provider result");

    const { resolveQuotaRuntimeContext } = await import("../src/lib/quota-runtime-context.js");
    const runtime = await resolveQuotaRuntimeContext({
      client: client as never,
      roots: { workspaceRoot: process.cwd() },
      config: currentConfig,
      providers: [minimaxCodingPlanProvider],
      configureTelemetry: false,
    });
    const { buildQuotaExport, createExportProviderContext } = await import(
      "../src/lib/quota-export.js"
    );
    const fetchCallsBeforeExport = vi.mocked(globalThis.fetch).mock.calls.length;
    const exportData = await buildQuotaExport({
      providers: [minimaxCodingPlanProvider],
      ctx: createExportProviderContext(runtime),
      ttlMs: currentConfig.minIntervalMs,
      fromCache: true,
    });
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(fetchCallsBeforeExport);
    const exportedProvider = exportData.providers["minimax-coding-plan"];
    expect(exportedProvider?.status).toBe("ok");
    if (!exportedProvider || !("entries" in exportedProvider)) {
      throw new Error("Expected cached MiniMax export entries");
    }
    expect(
      exportedProvider.entries.map((entry) =>
        entry.renderType === "percent" ? entry.percentRemaining : entry.value,
      ),
    ).toEqual([-5, -10]);

    const sidebarOutput = await v2.renderSidebar("minimax-session");
    expect(sidebarOutput).toContain("MiniMax");
    expect(
      sidebarOutput
        .split("\n")
        .map((line) => line.slice(0, 13).trim())
        .filter(Boolean)
        .join(" "),
    ).toBe("MiniMax Token Plan");
    expect(sidebarOutput).toContain("7d");
    expect(sidebarOutput).toContain("0%");
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);

    v2.dispose();
  });

  it("keeps the optional Anthropic Fable row in the command while the sidebar selects the minimum", async () => {
    currentConfig = configForSingleProvider("anthropic");
    mocks.loadConfig.mockImplementation(async () => currentConfig);
    mocks.hasAnthropicCredentialsConfigured.mockResolvedValue(true);
    const quota = {
      success: true,
      five_hour: { percentRemaining: 58, resetTimeIso: "2026-07-21T14:10:00.268Z" },
      seven_day: { percentRemaining: 72, resetTimeIso: "2026-07-27T07:00:00.268Z" },
      fable_weekly: {
        percentRemaining: 98,
        resetTimeIso: "2026-07-27T07:00:00.268Z",
      },
    };
    mocks.getAnthropicDiagnostics.mockResolvedValue({
      installed: true,
      version: "2.1.258",
      authStatus: "authenticated",
      quotaSupported: true,
      quotaSource: "opencode-auth-oauth-api",
      oauthCredentialSource: "opencode-auth",
      checkedCommands: ["claude --version"],
      quota,
    });
    mocks.queryAnthropicQuota.mockResolvedValue(quota);

    const { anthropicProvider } = await import("../src/providers/anthropic.js");
    anthropicProvider.cachePolicy = { kind: "account-neutral" };
    mocks.getProviders.mockReturnValue([anthropicProvider]);

    const client = createClient();
    client.config.providers.mockResolvedValue({
      data: { providers: [{ id: "anthropic" }] },
    });

    const v2 = await setupV2Surfaces(client, ["anthropic"]);
    await v2.quota.run();
    const serverOutput = v2.dialog.mock.calls[0][0].message;
    expect(serverOutput).toContain("Claude");
    expect(serverOutput).toContain("Fable");
    expect(serverOutput).toMatch(/Fable weekly quota +[█░]{24} +98% /u);

    const sidebarOutput = await v2.renderSidebar("anthropic-fable-session");
    expect(sidebarOutput).toContain("Claude");
    expect(sidebarOutput).toContain("58%");

    v2.dispose();
  });

  async function setupMiniMaxChinaSurfaces() {
    mocks.loadConfig.mockImplementation(async () => currentConfig);
    mocks.resolveMiniMaxChinaAuthCached.mockResolvedValue({
      state: "configured",
      apiKey: MINIMAX_CHINA_API_KEY,
      endpoint: "china",
    });
    mocks.getMiniMaxChinaAuthDiagnostics.mockResolvedValue({
      state: "configured",
      source: "opencode.db",
      endpoint: "china",
      checkedPaths: [],
      credentialDatabasePaths: [],
    });
    const { minimaxChinaCodingPlanProvider } = await import(
      "../src/providers/minimax-coding-plan.js"
    );
    minimaxChinaCodingPlanProvider.cachePolicy = { kind: "account-neutral" };
    mocks.getProviders.mockReturnValue([minimaxChinaCodingPlanProvider]);

    const client = createClient();
    client.config.providers.mockResolvedValue({
      data: { providers: [{ id: "minimax-china-coding-plan" }] },
    });
    return setupV2Surfaces(client, ["minimax-china-coding-plan"]);
  }

  it("renders CN general percentage quota and excludes video on command and sidebar", async () => {
    currentConfig = configForSingleProvider("minimax-china-coding-plan");
    const v2 = await setupMiniMaxChinaSurfaces();
    await v2.quota.run();
    const serverOutput = v2.dialog.mock.calls[0][0].message;
    expect(serverOutput).toContain("MiniMax Token Plan");
    expect(serverOutput).toContain("(CN)");
    expect(serverOutput).toMatch(/\n {2}5h +[█░]{24} +33% /u);
    expect(serverOutput).toMatch(/\n {2}Weekly +[█░]{24} +46% /u);
    expect(serverOutput).not.toContain("video");
    expect(serverOutput).not.toContain("Invalid normalized provider result");

    const sidebarOutput = await v2.renderSidebar("minimax-china-session");
    expect(sidebarOutput).toContain("MiniMax Token");
    expect(sidebarOutput).toContain("(CN)");
    expect(sidebarOutput).toContain("33%");
    expect(sidebarOutput).not.toContain("video");
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);

    v2.dispose();
  });
});
