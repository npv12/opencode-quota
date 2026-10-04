import { describe, expect, it } from "vitest";

import type { QuotaToastEntry } from "../src/lib/entries.js";
import { renderAccountingSurfaces } from "./helpers/accounting-surfaces.js";

const balanceAccounting = {
  resultType: "balance",
  acquisitionMethod: "remote_api",
  ownership: "maintained",
  authority: "provider_reported",
} as const;

function balanceEntry(
  currency: "USD" | "CNY",
  component: "total_balance" | "granted_balance" | "topped_up_balance",
  prominence: "primary" | "supplementary",
  decimal: string,
): QuotaToastEntry {
  return {
    kind: "quantity",
    accounting: balanceAccounting,
    name: `deepseek-${currency.toLowerCase()}-${component}`,
    group: "DeepSeek",
    semantic: { metric: { kind: "component", component }, prominence },
    quantity: { decimal, unit: { kind: "currency", code: currency } },
  };
}

function availabilityEntry(value: boolean): QuotaToastEntry {
  return {
    kind: "boolean",
    accounting: { ...balanceAccounting, resultType: "status" },
    name: "deepseek-availability",
    group: "DeepSeek",
    semantic: {
      metric: { kind: "named", name: "Availability" },
      prominence: "primary",
    },
    value,
  };
}

describe("DeepSeek structured provider surface formatting", () => {
  it("keeps USD and CNY totals separate and hides supplementary components in summary", () => {
    const outputs = renderAccountingSurfaces({
      data: {
        entries: [
          balanceEntry("USD", "total_balance", "primary", "12.340000000000000001"),
          balanceEntry("CNY", "total_balance", "primary", "88.25"),
        ],
        errors: [],
      },
      accountingDetail: "summary",
      showMaxWidth: 64,
      showNarrowAt: 44,
    });

    for (const output of [outputs.command, outputs.show, outputs.sidebar]) {
      expect(output).toContain("DeepSeek");
      expect(output).toContain("USD 12.34");
      expect(output).toContain("CNY 88.25");
      expect(output).not.toContain("Granted balance");
      expect(output).not.toContain("Topped-up balance");
      expect(output).not.toContain("$");
      expect(output).not.toContain("¥");
    }
  });

  it("shows granted and topped-up components in detailed output", () => {
    const outputs = renderAccountingSurfaces({
      data: {
        entries: [
          balanceEntry("USD", "total_balance", "primary", "12.34"),
          balanceEntry("USD", "granted_balance", "supplementary", "2"),
          balanceEntry("USD", "topped_up_balance", "supplementary", "10.34"),
        ],
        errors: [],
      },
      accountingDetail: "detailed",
      showMaxWidth: 64,
      showNarrowAt: 44,
    });

    for (const output of [outputs.command, outputs.show]) {
      expect(output).toContain("Granted balance");
      expect(output).toContain("USD 2.00");
      expect(output).toContain("Topped-up balance");
      expect(output).toContain("USD 10.34");
    }
    expect(outputs.sidebar).not.toContain("Granted");
    expect(outputs.sidebar).toContain("USD 2.00");
    expect(outputs.sidebar).not.toContain("Topped-up");
    expect(outputs.sidebar).toContain("USD 10.34");
    expect(outputs.show.split("\n").every((line) => line.length <= 64)).toBe(true);
    expect(outputs.sidebar.split("\n").every((line) => line.length <= 36)).toBe(true);
  });

  it.each([
    [true, "Available"],
    [false, "Low balance"],
  ])("renders the boolean availability fallback as %s", (value, text) => {
    const outputs = renderAccountingSurfaces({
      data: { entries: [availabilityEntry(value)], errors: [] },
      accountingDetail: "summary",
      showMaxWidth: 64,
      showNarrowAt: 44,
    });

    for (const output of [outputs.command, outputs.show]) {
      expect(output).toContain("Availability");
      expect(output).toContain(text);
      expect(output).not.toContain("Balance: 0");
    }
    expect(outputs.sidebar).toContain(text.startsWith("Low") ? "Low" : "Available");
    expect(outputs.sidebar).not.toContain("Balance: 0");
  });
});
