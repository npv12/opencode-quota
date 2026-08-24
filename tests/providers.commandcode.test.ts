import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  expectAttemptedWithErrorLabel,
  expectAttemptedWithNoErrors,
  expectNotAttempted,
  visibleEntries,
} from "./helpers/provider-assertions.js";
import { createProviderAvailabilityContext } from "./helpers/provider-test-harness.js";

const mocks = vi.hoisted(() => ({
  getCommandCodeKeyDiagnostics: vi.fn(),
  hasCommandCodeApiKeyConfigured: vi.fn(),
  queryCommandCodeQuota: vi.fn(),
}));

vi.mock("../src/lib/commandcode.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/commandcode.js")>();
  return {
    ...actual,
    getCommandCodeKeyDiagnostics: mocks.getCommandCodeKeyDiagnostics,
    hasCommandCodeApiKeyConfigured: mocks.hasCommandCodeApiKeyConfigured,
    queryCommandCodeQuota: mocks.queryCommandCodeQuota,
  };
});

import { commandCodeProvider } from "../src/providers/commandcode.js";

function successfulResult() {
  return {
    success: true as const,
    data: {
      userId: "user-1",
      userName: "pranav",
      planId: "individual-goat",
      currentPeriodStart: "2026-08-24T03:18:34.000Z",
      currentPeriodEnd: "2026-09-24T03:18:34.000Z",
      credits: {
        monthlyCredits: "69.0742629731",
        purchasedCredits: "0",
        freeCredits: "0",
        totalRemaining: "69.0742629731",
        fiveHour: {
          used: "0.9257370269",
          cap: "14",
          resetAt: "2026-08-24T06:26:21.470Z",
        },
        weekly: {
          used: "0.9257370269",
          cap: "35",
          resetAt: "2026-08-31T06:26:21.470Z",
        },
      },
      usage: {
        totalCount: "438",
        totalCost: "0.9257370269",
        totalTokens: "77217034",
        totalTokensIn: "76992780",
        totalTokensOut: "224254",
        successRate: "100",
      },
      parseIssues: [],
    },
  };
}

function diagnostics(state: "none" | "configured" = "configured"): Record<string, unknown> {
  return {
    configured: state === "configured",
    source: state === "none" ? null : "opencode.db",
    checkedPaths: ["env:COMMANDCODE_API_KEY", "/tmp/opencode.json"],
    credentialDatabasePaths: ["/tmp/opencode.db"],
  };
}

async function runFetch() {
  return commandCodeProvider.fetch(
    createProviderAvailabilityContext({
      configOverrides: { requestTimeoutMs: 5_000 },
    }),
  );
}

describe("commandcode provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCommandCodeKeyDiagnostics.mockResolvedValue(diagnostics());
    mocks.hasCommandCodeApiKeyConfigured.mockResolvedValue(true);
    mocks.queryCommandCodeQuota.mockResolvedValue(successfulResult());
  });

  it("returns not attempted for absent key without calling the API", async () => {
    mocks.getCommandCodeKeyDiagnostics.mockResolvedValueOnce(diagnostics("none"));
    mocks.queryCommandCodeQuota.mockResolvedValueOnce(null);

    const out = await runFetch();

    expectNotAttempted(out);
    expect(out.statusDetails).toEqual(
      expect.arrayContaining([{ key: "api_key_configured", value: "false" }]),
    );
  });

  it("passes the timeout to the API client", async () => {
    await commandCodeProvider.fetch(
      createProviderAvailabilityContext({
        configOverrides: { requestTimeoutMs: 12_345 },
      }),
    );

    expect(mocks.queryCommandCodeQuota).toHaveBeenCalledWith({ requestTimeoutMs: 12_345 });
  });

  it("returns canonical quota/spend/usage entries", async () => {
    const out = await runFetch();

    expectAttemptedWithNoErrors(out);
    expect(visibleEntries(out.entries, "commandcode")).toEqual([
      {
        kind: "quantity",
        name: "commandcode-remaining-credits",
        group: "Command Code",
        semantic: {
          metric: { kind: "component", component: "remaining_credits" },
          prominence: "primary",
        },
        quantity: { decimal: "69.0742629731", unit: { kind: "currency", code: "USD" } },
      },
      {
        name: "commandcode-fiveHour-remaining",
        group: "Command Code",
        label: "5h:",
        percentRemaining: 93,
        resetTimeIso: "2026-08-24T06:26:21.470Z",
      },
      {
        name: "commandcode-weekly-remaining",
        group: "Command Code",
        label: "Weekly:",
        percentRemaining: 97,
        resetTimeIso: "2026-08-31T06:26:21.470Z",
      },
      {
        kind: "quantity",
        name: "commandcode-period-cost",
        group: "Command Code",
        semantic: { metric: { kind: "named", name: "Billed" }, prominence: "supplementary" },
        quantity: { decimal: "0.9257370269", unit: { kind: "currency", code: "USD" } },
      },
      {
        kind: "quantity",
        name: "commandcode-period-tokens",
        group: "Command Code",
        semantic: { metric: { kind: "named", name: "Tokens" }, prominence: "supplementary" },
        quantity: { decimal: "77217034", unit: { kind: "count", unit: "token" } },
      },
      {
        kind: "quantity",
        name: "commandcode-period-requests",
        group: "Command Code",
        semantic: { metric: { kind: "named", name: "Requests" }, prominence: "supplementary" },
        quantity: { decimal: "438", unit: { kind: "count", unit: "request" } },
      },
      {
        kind: "value",
        name: "commandcode-plan",
        group: "Command Code",
        label: "Plan:",
        value: "individual-goat",
      },
    ]);
  });

  it("returns API failures as attempted errors", async () => {
    mocks.queryCommandCodeQuota.mockResolvedValueOnce({
      success: false,
      error: "Command Code API error 403: MODEL_NOT_IN_PLAN",
      retryable: false,
    });

    const out = await runFetch();

    expectAttemptedWithErrorLabel(out, "Command Code");
    expect(out.errors[0]?.message).toBe("Command Code API error 403: MODEL_NOT_IN_PLAN");
  });

  it("does not copy the resolved token into provider output", async () => {
    const out = await runFetch();
    expect(JSON.stringify(out)).not.toContain("provider-test-token");
  });
});

describe("commandcode availability and model matching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([[true], [false]])("isAvailable falls back to key configured (%s)", async (hasKey) => {
    mocks.hasCommandCodeApiKeyConfigured.mockResolvedValueOnce(hasKey);

    await expect(
      commandCodeProvider.isAvailable(createProviderAvailabilityContext()),
    ).resolves.toBe(hasKey);
    expect(mocks.queryCommandCodeQuota).not.toHaveBeenCalled();
  });

  it.each([
    ["commandcode/claude-sonnet-5", true],
    ["commandcode/deepseek/deepseek-v4-flash", true],
    ["openai/gpt-5.6", false],
  ])("matchesCurrentModel(%s) -> %s", (model, expected) => {
    expect(commandCodeProvider.matchesCurrentModel?.(model)).toBe(expected);
  });
});
