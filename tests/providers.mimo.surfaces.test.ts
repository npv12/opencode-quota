import { describe, expect, it } from "vitest";
import type { QuotaToastEntry } from "../src/lib/entries.js";
import { renderAccountingSurfaces } from "./helpers/accounting-surfaces.js";

const quotaAccounting = {
  resultType: "quota",
  acquisitionMethod: "dashboard_scrape",
  ownership: "maintained",
  authority: "provider_reported",
} as const;
const balanceAccounting = { ...quotaAccounting, resultType: "balance" } as const;
const group = "Xiaomi MiMo: Standard [standard_monthly]";

const monthlyQuota: QuotaToastEntry = {
  accounting: quotaAccounting,
  name: `${group} Monthly`,
  group,
  percentRemaining: 75,
  semantic: {
    metric: { kind: "window", window: "month" },
    prominence: "primary",
  },
  basis: {
    used: {
      quantity: { decimal: "25", unit: { kind: "count", unit: "token" } },
      authority: "provider_reported",
    },
    limit: {
      quantity: { decimal: "100", unit: { kind: "count", unit: "token" } },
      authority: "provider_reported",
    },
  },
};

function balanceEntry(
  component: "total_balance" | "cash_balance" | "gift_balance",
  prominence: "primary" | "supplementary",
  decimal: string,
  currency: string | null = "USD",
): QuotaToastEntry {
  return {
    kind: "quantity",
    accounting: balanceAccounting,
    name: `xiaomi-mimo-${component}`,
    group,
    semantic: { metric: { kind: "component", component }, prominence },
    quantity: {
      decimal,
      unit: currency ? { kind: "currency", code: currency } : { kind: "count", unit: "credit" },
    },
  };
}

describe("Xiaomi MiMo structured provider surface formatting", () => {
  it("shows plan identity, monthly token quota, and separate balance components", () => {
    const outputs = renderAccountingSurfaces({
      data: {
        entries: [
          monthlyQuota,
          balanceEntry("total_balance", "primary", "50"),
          balanceEntry("cash_balance", "supplementary", "30"),
          balanceEntry("gift_balance", "supplementary", "20"),
        ],
        errors: [],
      },
      accountingDetail: "detailed",
      showMaxWidth: 72,
      showNarrowAt: 48,
    });

    for (const output of [outputs.command, outputs.show]) {
      expect(output).toContain("Xiaomi MiMo");
      expect(output).toContain("Standard");
      expect(output).toContain("Monthly quota");
      expect(output).toContain("75%");
      expect(output).toContain("Total balance");
      expect(output).toContain("USD 50.00");
      expect(output).toContain("Cash balance");
      expect(output).toContain("Gift balance");
      expect(output).not.toContain("$");
    }
    expect(outputs.sidebar).toContain("Xiaomi");
    expect(outputs.sidebar).toContain("30d");
    expect(outputs.sidebar).toContain("75%");
    expect(outputs.sidebar).not.toContain("Total");
    expect(outputs.sidebar).not.toContain("Cash");
    expect(outputs.sidebar).not.toContain("Gift");
    expect(outputs.sidebar).toContain("50.00");
    expect(outputs.sidebar).toContain("30.00");
    expect(outputs.sidebar).toContain("20.00");
    expect(outputs.sidebar).not.toContain("$");
    expect(outputs.command).toContain(group);
    expect(outputs.command).toContain("Used: 25 tokens");
    expect(outputs.command).toContain("Limit: 100 tokens");
    expect(outputs.show.split("\n").every((line) => line.length <= 72)).toBe(true);
    expect(outputs.sidebar.split("\n").every((line) => line.length <= 36)).toBe(true);
  });

  it("renders missing-currency balances as credit counts", () => {
    const outputs = renderAccountingSurfaces({
      data: {
        entries: [balanceEntry("total_balance", "primary", "12.5", null)],
        errors: [],
      },
      accountingDetail: "detailed",
      showMaxWidth: 72,
      showNarrowAt: 48,
    });

    for (const output of [outputs.command, outputs.show]) {
      expect(output).toContain("Total balance");
      expect(output).toContain("12.5 credits");
      expect(output).not.toContain("USD");
      expect(output).not.toContain("$");
    }
    expect(outputs.sidebar).not.toContain("Total");
    expect(outputs.sidebar).toContain("12.5");
    expect(outputs.sidebar).toContain("credits");
    expect(outputs.sidebar).not.toContain("USD");
    expect(outputs.sidebar).not.toContain("$");
  });
});
