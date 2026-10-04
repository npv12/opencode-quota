import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  messageDocument,
  type ReportDocument,
  renderPlainTextReport,
} from "../src/lib/report-document.js";
import type { DEFAULT_CONFIG } from "../src/lib/types.js";
import { createFakeIntegration } from "./helpers/fake-integration.js";
import {
  createAlibabaAuthModuleMock,
  createConfigModuleMock,
  createPluginRuntimePathsMockModule,
  createPricingModuleMock,
  createProvidersRegistryModuleMock,
  createSessionTokensModuleMock,
  makeQuotaToastTestConfig,
  seedDefaultPluginBootstrapMocks,
} from "./helpers/plugin-test-harness.js";

const TEST_RUNTIME_ROOT = "/tmp/opencode-quota-plugin-rpc-tests";
const TEST_ACCOUNTING = {
  resultType: "quota",
  acquisitionMethod: "remote_api",
  ownership: "maintained",
  authority: "provider_reported",
} as const;

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

type Handler = (input: unknown, context: unknown) => Promise<unknown>;
type RegisteredCommand = {
  name: string;
  execute: (invocation: { sessionID: string; prompt: { text: string } }) => Promise<void>;
};

const callContext = {
  signal: new AbortController().signal,
  error: (type: string, message: string, data?: unknown) => ({ type, message, data }),
};

function useConfig(overrides: Partial<typeof DEFAULT_CONFIG>): void {
  mocks.loadConfig.mockResolvedValue(
    makeQuotaToastTestConfig({
      enabled: true,
      enabledProviders: ["copilot"],
      minIntervalMs: 0,
      showSessionTokens: false,
      ...overrides,
    }),
  );
}

async function setupServer(sessionGet = vi.fn().mockResolvedValue({}), directory = process.cwd()) {
  const { default: server } = await import("../src/plugin.js");
  const register = vi.fn(async () => ({ dispose: async () => {}, events: { emit: vi.fn() } }));
  const commands: RegisteredCommand[] = [];
  const ctx = {
    location: { directory },
    provider: { list: vi.fn().mockResolvedValue({ data: [{ id: "copilot" }] }) },
    session: { get: sessionGet, wait: vi.fn(), prompt: vi.fn(), hook: vi.fn() },
    command: {
      transform: vi.fn(async (callback) => {
        callback({ add: (command: RegisteredCommand) => commands.push(command) });
      }),
    },
    rpc: { register },
    integration: createFakeIntegration([]),
    event: { subscribe: () => ({ async *[Symbol.asyncIterator]() {} }) },
  };
  await server.setup(ctx as never);
  expect(register).toHaveBeenCalledOnce();
  const [definition, handlers] = register.mock.calls[0] as unknown as [
    { id: string; methods: Record<string, unknown> },
    Record<string, Handler>,
  ];
  const call = async (method: string, input: unknown) => {
    const output = await handlers[method](input, callContext);
    // Outputs travel over HTTP to every client; they must never carry login secrets.
    expect(JSON.stringify(output)).not.toMatch(/"(access|refresh|apiKey)"/);
    // OpenCode's RPC route rejects any output that is not a JSON value (HTTP 400), so an
    // undefined field or a non-finite number must never reach it.
    expect(output).toStrictEqual(JSON.parse(JSON.stringify(output)));
    return output;
  };
  return { ctx, definition, handlers, commands, call };
}

describe("server quota RPC", () => {
  beforeEach(async () => {
    seedDefaultPluginBootstrapMocks(mocks, { resetPluginState: true });
    mocks.getProviders.mockReturnValue([
      {
        id: "copilot",
        isAvailable: vi.fn().mockResolvedValue(true),
        fetch: vi.fn().mockResolvedValue({
          attempted: true,
          entries: [{ accounting: TEST_ACCOUNTING, name: "Copilot", percentRemaining: 81 }],
          errors: [],
        }),
      },
    ]);
    await rm(TEST_RUNTIME_ROOT, { recursive: true, force: true });
    const { __resetQuotaStateForTests } = await import("../src/lib/quota-state.js");
    __resetQuotaStateForTests();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(TEST_RUNTIME_ROOT, { recursive: true, force: true });
  });

  it("registers the quota RPC with its two methods during setup", async () => {
    const { QuotaRpc } = await import("../src/rpc.js");
    const { definition, handlers } = await setupServer();

    expect(definition).toBe(QuotaRpc);
    expect(definition.id).toBe("npv12.opencode-quota");
    expect(Object.keys(definition.methods)).toEqual(["surface", "command"]);
    expect(Object.keys(handlers)).toEqual(Object.keys(definition.methods));
  });

  it("serves the sidebar panel", async () => {
    useConfig({});
    const { call } = await setupServer();

    const sidebar = (await call("surface", { surface: "sidebar", sessionID: "session-1" })) as {
      quota: { message: string };
    };
    expect(sidebar.quota.message).toContain("Copilot");
  });

  it("returns a null quota when the sidebar panel is turned off", async () => {
    useConfig({ tuiSidebarPanel: { enabled: false } });
    const { call } = await setupServer();

    await expect(call("surface", { surface: "sidebar", sessionID: "session-1" })).resolves.toEqual({
      quota: null,
    });
  });

  it("runs palette commands on the server and returns their output", async () => {
    useConfig({});
    const { call } = await setupServer();

    const output = (await call("command", { command: "quota", sessionID: "session-1" })) as {
      output: string;
      document: ReportDocument;
    };
    expect(output).toEqual(
      expect.objectContaining({
        state: "output",
        command: "quota",
        title: "OpenCode Quota",
        dialogSize: "xlarge",
      }),
    );
    expect(output.output).toContain("Copilot");
    expect(renderPlainTextReport(output.document)).toBe(output.output);
  });

  it("returns a failed palette command as output instead of an RPC error", async () => {
    useConfig({});
    const dialogModule = await import("../src/lib/quota-dialog-commands.js");
    vi.spyOn(dialogModule, "buildQuotaDialogCommandOutput").mockRejectedValue(
      new Error("quota \u001b[31mbroke"),
    );
    const { call } = await setupServer();

    await expect(call("command", { command: "quota" })).resolves.toEqual({
      state: "output",
      command: "quota",
      title: "OpenCode Quota",
      output: "quota broke",
      document: messageDocument("quota broke"),
      dialogSize: "xlarge",
    });
  });

  it("treats a session the server cannot find as a session without a model", async () => {
    useConfig({ onlyCurrentModel: true });
    const input = { surface: "sidebar", sessionID: "missing" };
    const withoutModel = await setupServer(vi.fn().mockResolvedValue({}));
    const expected = await withoutModel.call("surface", input);
    const sessionGet = vi.fn().mockRejectedValue(new Error("Session not found"));
    const missing = await setupServer(sessionGet);

    await expect(missing.call("surface", input)).resolves.toEqual(expected);
    expect(sessionGet).toHaveBeenCalledWith({ sessionID: "missing" });
  });

  it("computes quota for the location's project folder, not the service's working folder", async () => {
    useConfig({});
    const workspaceRoots: string[] = [];
    mocks.getProviders.mockReturnValue([
      {
        id: "copilot",
        isAvailable: vi.fn().mockResolvedValue(true),
        fetch: vi.fn(async (ctx: { workspaceRoot: string }) => {
          workspaceRoots.push(ctx.workspaceRoot);
          return {
            attempted: true,
            entries: [{ accounting: TEST_ACCOUNTING, name: "Copilot", percentRemaining: 81 }],
            errors: [],
          };
        }),
      },
    ]);
    const project = `${TEST_RUNTIME_ROOT}/project`;
    const { call } = await setupServer(undefined, project);

    await call("surface", { surface: "sidebar", sessionID: "session-1" });
    await call("command", { command: "quota", sessionID: "session-1" });

    expect(workspaceRoots).toHaveLength(2);
    expect(new Set(workspaceRoots)).toEqual(new Set([project]));
    expect(project).not.toBe(process.cwd());
  });

  it("logs why a surface RPC failed, without tokens, and still fails it", async () => {
    const token = `eyJ${"a".repeat(24)}.${"b".repeat(24)}.${"c".repeat(24)}`;
    mocks.loadConfig.mockRejectedValue(new Error(`config broke ${token}`));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { handlers } = await setupServer();

    for (const [method, input] of [
      ["surface", { surface: "sidebar", sessionID: "session-1" }],
    ] as const) {
      await expect(handlers[method](input, callContext)).rejects.toThrow("config broke");
      expect(warn).toHaveBeenLastCalledWith(
        `[opencode-quota] ${method} RPC failed: config broke [redacted]`,
      );
    }
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
  });
});
