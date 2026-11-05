import { afterEach, expect, it, vi } from "vitest";
import { rowsFromProviderResult } from "../src/core/rows.js";
import type { QuotaSnapshot } from "../src/core/types.js";
import { readCredentialRows } from "../src/lib/opencode-auth.js";
import { openaiProvider } from "../src/providers/openai.js";
import { defaultSettings } from "../src/settings/schema.js";
import { minimalSidebarLines } from "../src/view/minimal-sidebar.js";
import { lineText } from "../src/view/text.js";
import { fakeHttp, requestHeader } from "./helpers/provider-fetch.js";

vi.mock("../src/lib/opencode-auth.js", async (original) => ({
  ...(await original<typeof import("../src/lib/opencode-auth.js")>()),
  readCredentialRows: vi.fn(),
}));
afterEach(() => vi.unstubAllGlobals());

async function snapshot(credits: unknown, several = false): Promise<QuotaSnapshot> {
  vi.mocked(readCredentialRows).mockResolvedValue(
    (several ? ["A", "B"] : ["A"]).map((label) => ({
      id: label,
      integrationId: "openai",
      label,
      active: label === "A",
      value: { type: "oauth", access: label },
    })),
  );
  const http = fakeHttp((_url, init) => ({
    plan_type: "pro",
    rate_limit: {
      primary_window: {
        limit_window_seconds: 18000,
        used_percent: 28,
      },
    },
    credits:
      several && requestHeader(init, "Authorization") === "Bearer B"
        ? { has_credits: true, balance: "2500.25" }
        : credits,
  }));
  const fetched = rowsFromProviderResult(
    "openai",
    await openaiProvider.fetch({ config: {} } as never),
  );
  expect(fetched.error).toBeUndefined();
  expect(http).toHaveBeenCalledTimes(several ? 2 : 1);
  return {
    version: 6,
    providers: [
      {
        providerId: "openai",
        label: "OpenAI",
        rows: fetched.rows,
        checkedAtMs: 0,
        refreshing: false,
      },
    ],
    resetNotices: [],
    generatedAtMs: 0,
    serverId: "test",
    revision: 1,
  };
}

const sidebarText = (result: QuotaSnapshot): string =>
  minimalSidebarLines({ snapshot: result, settings: defaultSettings(), nowMs: 0 })
    .map(lineText)
    .join("\n");

it.each([
  "1250.5",
  "0",
  "0.000001",
  "9007199254740993.123456789000",
])("keeps exact decimal %s", async (balance) => {
  const result = await snapshot({ has_credits: true, balance });
  expect(
    result.providers[0]!.rows.find((row) => row.id === "openai.codex_credits")?.amount?.decimal,
  ).toBe(balance);
});
it.each([
  undefined,
  null,
  {},
  { has_credits: false },
  { has_credits: false, unlimited: false, balance: null },
  { has_credits: false, balance: "0" },
  { balance: "12.5" },
])("adds no credits row for %j", async (credits) => {
  const rows = (await snapshot(credits)).providers[0]!.rows;
  expect(rows.map((row) => row.id)).toEqual(["openai.five_hour"]);
});
it.each([
  { has_credits: true },
  { has_credits: true, balance: null },
  { has_credits: true, balance: "bad" },
  { has_credits: true, balance: 12 },
  { has_credits: true, balance: "-1" },
])("shows no data for %j", async (credits) => {
  const row = (await snapshot(credits)).providers[0]!.rows.find(
    (item) => item.id === "openai.codex_credits",
  );
  expect(row?.text).toBe("No data");
  expect(row?.amount).toBeUndefined();
});
it("honors explicit unlimited before the balance", async () => {
  const row = (await snapshot({ unlimited: true, balance: "0" })).providers[0]!.rows.at(-1);
  expect(row?.text).toBe("Unlimited credits");
  expect(row?.amount).toBeUndefined();
});
it("keeps the fraction in the sidebar", async () => {
  const result = await snapshot({ has_credits: true, balance: "1250.5" });
  const text = sidebarText(result);
  expect(text).toContain("1,250.5 credits left");
});
it("keeps account balances separate, named, hidden and stale", async () => {
  const result = await snapshot({ has_credits: true, balance: "1250.5" }, true);
  result.providers[0]!.error = { code: "network" };

  const text = sidebarText(result);
  expect(text).toContain("1,250.5 credits left");
  expect(text).toContain("2,500.25 credits left");
  expect(text).toContain("Can't reach");

  const settings = defaultSettings();
  settings.sidebar.hidden = ["openai.codex_credits"];
  const hidden = minimalSidebarLines({ snapshot: result, settings, nowMs: 0 })
    .map(lineText)
    .join("\n");
  expect(hidden).not.toContain("1,250.5");
  expect(hidden).not.toContain("2,500.25");
});
