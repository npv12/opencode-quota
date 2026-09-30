import { describe, expect, it, vi } from "vitest";

import { formatQuotaRows } from "../src/lib/format.js";
import { formatQuotaCommand } from "../src/lib/quota-command-format.js";
import { buildSidebarQuotaPanelLines } from "../src/lib/tui-sidebar-format.js";
import { googleAgyProvider } from "../src/providers/google-agy.js";

const mocks = vi.hoisted(() => ({
  queryGoogleAgyQuota: vi.fn(),
}));

vi.mock("../src/lib/google-agy.js", () => ({
  AGY_AUTH_KEYS: ["google-agy", "opencode-agy-auth", "google-agy-auth"],
  hasAgyQuotaRuntimeAvailable: vi.fn(async () => true),
  queryGoogleAgyQuota: mocks.queryGoogleAgyQuota,
  inspectAgyAuthPresence: vi.fn(async () => ({
    state: "missing",
    sourceKey: null,
    accountCount: 0,
    validAccountCount: 0,
  })),
}));

vi.mock("../src/lib/google-agy-companion.js", () => ({
  inspectAgyCompanionPresence: vi.fn(async () => ({
    state: "missing",
    error: "companion unavailable",
  })),
}));

function bucket(params: {
  family: "Gemini Models" | "Claude and GPT models";
  window: "weekly" | "five_hour";
  percentRemaining: number;
  accountEmail: string;
  accountIndex: number;
}) {
  return {
    ...params,
    windowLabel: params.window === "weekly" ? "Weekly" : "5h",
    sourceKey: "google-agy",
  };
}

describe("Google AGY provider surfaces", () => {
  it("keeps accounts and families distinct while the sidebar selects each limiting window", async () => {
    mocks.queryGoogleAgyQuota.mockResolvedValueOnce({
      success: true,
      buckets: [
        bucket({
          family: "Gemini Models",
          window: "five_hour",
          percentRemaining: 100,
          accountEmail: "alice@example.com",
          accountIndex: 0,
        }),
        bucket({
          family: "Gemini Models",
          window: "weekly",
          percentRemaining: 99,
          accountEmail: "alice@example.com",
          accountIndex: 0,
        }),
        bucket({
          family: "Claude and GPT models",
          window: "five_hour",
          percentRemaining: 100,
          accountEmail: "alice@example.com",
          accountIndex: 0,
        }),
        bucket({
          family: "Claude and GPT models",
          window: "weekly",
          percentRemaining: 82,
          accountEmail: "alice@example.com",
          accountIndex: 0,
        }),
        bucket({
          family: "Gemini Models",
          window: "five_hour",
          percentRemaining: 90,
          accountEmail: "bob@example.com",
          accountIndex: 1,
        }),
        bucket({
          family: "Gemini Models",
          window: "weekly",
          percentRemaining: 75,
          accountEmail: "bob@example.com",
          accountIndex: 1,
        }),
        bucket({
          family: "Claude and GPT models",
          window: "five_hour",
          percentRemaining: 80,
          accountEmail: "bob@example.com",
          accountIndex: 1,
        }),
        bucket({
          family: "Claude and GPT models",
          window: "weekly",
          percentRemaining: 60,
          accountEmail: "bob@example.com",
          accountIndex: 1,
        }),
      ],
      errors: [],
    });

    const result = await googleAgyProvider.fetch({ client: {} } as any);
    const { entries, errors } = result;
    const headers = [
      "[AGY (ali…): Gemini]",
      "[AGY (ali…): Claude/GPT]",
      "[AGY (bob…): Gemini]",
      "[AGY (bob…): Claude/GPT]",
    ];

    const show = formatQuotaRows({
      version: "test",
      style: "allWindows",
      layout: { maxWidth: 50, narrowAt: 42, tinyAt: 32 },
      entries,
      errors,
    });
    const sidebar = buildSidebarQuotaPanelLines({
      data: { entries, errors },
      config: { percentDisplayMode: "remaining" },
    }).join("\n");
    const command = formatQuotaCommand({ entries, errors });

    for (const header of headers) {
      expect(show).toContain(header);
      expect(command).toContain(header);
    }
    expect(show).toContain("Weekly");
    expect(show).toContain("5h");
    expect(show.indexOf("Weekly")).toBeLessThan(show.indexOf("5h"));
    expect(sidebar).toContain("Antigravity");
    expect(sidebar).toContain("7d");
    expect(sidebar).not.toContain("5h");
    expect(sidebar).toContain("99%");
    expect(sidebar).toContain("82%");
    expect(sidebar).toContain("75%");
    expect(sidebar).toContain("60%");
    expect(sidebar.split("\n")).toHaveLength(4);
    expect(sidebar).not.toContain("left");
    expect(command.indexOf("Week quota")).toBeLessThan(command.indexOf("5h quota"));
    expect(entries.map((entry) => entry.accounting.sourceId)).toEqual([
      "account-1",
      "account-1",
      "account-1",
      "account-1",
      "account-2",
      "account-2",
      "account-2",
      "account-2",
    ]);
  });
});
