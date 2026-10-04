import { describe, expect, it } from "vitest";

import type { QuotaToastEntry } from "../src/lib/entries.js";
import { renderAccountingSurfaces } from "./helpers/accounting-surfaces.js";

const accounting = {
  resultType: "quota" as const,
  acquisitionMethod: "remote_api" as const,
  ownership: "maintained" as const,
  authority: "provider_reported" as const,
};

const entries: QuotaToastEntry[] = [
  {
    accounting,
    name: "Claude 5h",
    group: "Claude",
    label: "5h:",
    percentRemaining: 43,
  },
  {
    accounting,
    name: "Claude Weekly",
    group: "Claude",
    label: "Weekly:",
    percentRemaining: 88,
  },
  {
    accounting,
    name: "Claude Usage Credits",
    group: "Claude Usage Credits",
    label: "Monthly:",
    percentRemaining: 62,
  },
];

describe("Anthropic provider surface formatting", () => {
  it("identifies Usage Credits without changing the existing Claude quota rows", () => {
    const outputs = renderAccountingSurfaces({
      data: { entries, errors: [] },
      accountingDetail: "summary",
      showMaxWidth: 64,
      showNarrowAt: 44,
    });

    for (const output of [outputs.command, outputs.show]) {
      expect(output).toContain("Claude Usage Credits");
      expect(output).toContain("43%");
      expect(output).toContain("88%");
      expect(output).toContain("62%");
      expect(output).toMatch(/Month(?:ly| quota)/u);
    }

    expect(outputs.sidebar).toContain("Claude");
    expect(outputs.sidebar).toContain("5h");
    expect(outputs.sidebar).toContain("43%");
    expect(outputs.sidebar).toContain("30d");
    expect(outputs.sidebar).toContain("62%");
    expect(outputs.sidebar.split("\n")).toHaveLength(2);
    expect(outputs.sidebar).not.toContain("88%");
  });
});
