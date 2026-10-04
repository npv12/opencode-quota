import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoadConfigMeta } from "../src/lib/config.js";
import type { CollectQuotaRenderDataResult } from "../src/lib/quota-render-data.js";
import type { QuotaRuntimeContext } from "../src/lib/quota-runtime-context.js";
import type { QuotaSurfaceHost } from "../src/lib/quota-surface-data.js";
import { createRuntimeProviderIdResolver } from "../src/lib/runtime-provider-ids.js";
import { DEFAULT_CONFIG } from "../src/lib/types.js";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), collect: vi.fn() }));
vi.mock("../src/lib/quota-runtime-context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/quota-runtime-context.js")>()),
  resolveQuotaRuntimeContext: mocks.resolve,
}));
vi.mock("../src/lib/quota-render-data.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/quota-render-data.js")>()),
  collectQuotaRenderData: mocks.collect,
}));

import { getQuotaMessage } from "../src/lib/quota-surface-data.js";

const host: QuotaSurfaceHost = {
  client: {
    config: {
      get: async () => ({ data: {} }),
      providers: async () => ({ data: { providers: [] } }),
    },
  },
  roots: {
    workspaceRoot: "/project",
    configRoot: "/project",
    fallbackDirectory: "/project/nested",
  },
  resolveSessionMeta: vi.fn().mockResolvedValue({ providerID: "openai", modelID: "gpt-5" }),
};

describe("sidebar quota data", () => {
  let runtime: QuotaRuntimeContext;
  let result: CollectQuotaRenderDataResult;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = {
      client: host.client,
      roots: { workspaceRoot: "/project", configRoot: "/project" },
      config: { ...DEFAULT_CONFIG },
      configMeta: createLoadConfigMeta(),
      providers: [],
      resolveRuntimeProviderIds: createRuntimeProviderIdResolver(host.client),
      session: { sessionID: "ses_1", sessionMeta: { providerID: "openai", modelID: "gpt-5" } },
    };
    result = {
      selection: null,
      availability: [],
      active: [],
      providerResults: [],
      attemptedAny: true,
      hasExplicitProviderIssues: false,
      data: {
        entries: [
          {
            accounting: {
              resultType: "quota",
              acquisitionMethod: "remote_api",
              ownership: "maintained",
              authority: "provider_reported",
            },
            name: "OpenAI",
            group: "OpenAI",
            label: "5h",
            percentRemaining: 80,
          },
          {
            accounting: {
              resultType: "quota",
              acquisitionMethod: "remote_api",
              ownership: "maintained",
              authority: "provider_reported",
            },
            name: "OpenAI",
            group: "OpenAI",
            label: "Weekly",
            percentRemaining: 15,
          },
        ],
        errors: [],
      },
    };
    mocks.resolve.mockResolvedValue(runtime);
    mocks.collect.mockResolvedValue(result);
  });

  it("collects all windows regardless of root CLI style before selecting the minimum", async () => {
    const quota = await getQuotaMessage(host, "ses_1");
    expect(mocks.collect).toHaveBeenCalledWith(
      expect.objectContaining({
        config: runtime.config,
        formatStyle: "allWindows",
        workspaceRoot: "/project",
        request: runtime.session,
        resolveRuntimeProviderIds: runtime.resolveRuntimeProviderIds,
        surfaceExplicitProviderIssues: true,
      }),
    );
    expect(quota?.message).toMatch(/OpenAI\s+7d\s+15%$/u);
    expect(quota?.message).not.toContain("80%");
    expect(Object.keys(quota!)).toEqual(["message"]);
  });

  it("uses the same location roots and session model policy as server commands", async () => {
    await getQuotaMessage(host, "ses_1");
    const params = mocks.resolve.mock.calls[0]![0];
    expect(params).toMatchObject({
      client: host.client,
      roots: host.roots,
      sessionID: "ses_1",
      resolveSessionMeta: host.resolveSessionMeta,
    });
    expect(params.includeSessionMeta({ ...DEFAULT_CONFIG, onlyCurrentModel: false })).toBe(false);
    expect(params.includeSessionMeta({ ...DEFAULT_CONFIG, onlyCurrentModel: true })).toBe(true);
  });

  it.each(["plugin", "sidebar"])("does not collect quota when %s is disabled", async (feature) => {
    runtime.config =
      feature === "plugin"
        ? { ...DEFAULT_CONFIG, enabled: false }
        : { ...DEFAULT_CONFIG, tuiSidebarPanel: { enabled: false } };
    await expect(getQuotaMessage(host, "ses_1")).resolves.toBeUndefined();
    expect(mocks.collect).not.toHaveBeenCalled();
  });

  it("returns no message when provider collection has no data", async () => {
    result.data = null;
    await expect(getQuotaMessage(host, "ses_1")).resolves.toBeUndefined();
  });

  it("preserves errors even when no provider returned a quota row", async () => {
    result.data = {
      entries: [],
      errors: [{ label: "Copilot", message: "Sign in required\u0007" }],
    };
    await expect(getQuotaMessage(host, "ses_1")).resolves.toEqual({
      message: "Copilot: Sign in required",
    });
  });

  it("propagates collection failures to the server RPC error handler", async () => {
    mocks.collect.mockRejectedValue(new Error("Collection failed"));
    await expect(getQuotaMessage(host, "ses_1")).rejects.toThrow("Collection failed");
  });
});
