import { afterEach, describe, expect, it, vi } from "vitest";

import type { QuotaToastEntry } from "../src/lib/entries.js";
import { formatQuotaRows } from "../src/lib/format.js";
import { formatQuotaCommand } from "../src/lib/quota-command-format.js";
import type { QuotaRenderData } from "../src/lib/quota-render-data.js";
import { buildSidebarQuotaPanelLines } from "../src/lib/tui-sidebar-format.js";
import type { PercentDisplayMode } from "../src/lib/types.js";
import { renderAccountingSurfaces } from "./helpers/accounting-surfaces.js";

const accounting = {
  resultType: "quota" as const,
  acquisitionMethod: "remote_api" as const,
  ownership: "maintained" as const,
  authority: "provider_reported" as const,
};

function goWindow(
  name: string,
  label: string,
  percentRemaining: number,
  resetTimeIso?: string,
): QuotaToastEntry {
  return {
    accounting,
    name,
    group: "OpenCode Go",
    label,
    percentRemaining,
    resetTimeIso,
  };
}

const exhaustedWeeklyEntries: QuotaToastEntry[] = [
  goWindow("OpenCode Go 5h", "5h:", 83, "2026-08-12T12:30:00.000Z"),
  goWindow("OpenCode Go Weekly", "Weekly:", 0, "2026-08-16T16:00:00.000Z"),
  goWindow("OpenCode Go Monthly", "Monthly:", 9, "2026-09-01T04:00:00.000Z"),
];

function renderSurfaces(params: {
  entries: QuotaToastEntry[];
  percentDisplayMode: PercentDisplayMode;
}): {
  command: string;
  show: string;
  sidebar: string;
} {
  const data: QuotaRenderData = { entries: params.entries, errors: [] };
  const { percentDisplayMode } = params;

  return {
    command: formatQuotaCommand({
      ...data,
      generatedAtMs: 0,
      accountingDetail: "summary",
      percentDisplayMode,
    }),
    show: formatQuotaRows({
      version: "test",
      style: "allWindows",
      layout: { maxWidth: 64, narrowAt: 44, tinyAt: 32 },
      entries: data.entries,
      errors: data.errors,
      accountingDetail: "summary",
      percentDisplayMode,
    }),
    sidebar: buildSidebarQuotaPanelLines({
      data,
      config: { percentDisplayMode },
    }).join("\n"),
  };
}

describe("OpenCode Go exhausted-window surfaces", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps an unstarted five-hour window blank when all windows have 100 percent remaining", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T04:40:02.000Z"));
    const outputs = renderSurfaces({
      entries: [
        goWindow("OpenCode Go 5h", "5h:", 100),
        goWindow("OpenCode Go Weekly", "Weekly:", 100, "2026-10-05T00:00:00.000Z"),
        goWindow("OpenCode Go Monthly", "Monthly:", 100, "2026-10-30T18:40:02.000Z"),
      ],
      percentDisplayMode: "remaining",
    });

    expect(outputs.sidebar).toBe("OpenCode Go           5h        100%");
    expect(outputs.command).toContain("29d14h0m");
    expect(outputs.show).toContain("Monthly");
    expect(outputs.show.match(/100% left/gu)).toHaveLength(3);
    expect(outputs.sidebar).not.toContain("29.6d");
  });

  it("shows a real five-hour reset even when every window has 100 percent remaining", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T04:40:02.000Z"));
    const outputs = renderSurfaces({
      entries: [
        goWindow("OpenCode Go 5h", "5h:", 100, "2026-10-01T07:40:02.000Z"),
        goWindow("OpenCode Go Weekly", "Weekly:", 100, "2026-10-05T00:00:00.000Z"),
        goWindow("OpenCode Go Monthly", "Monthly:", 100, "2026-10-30T18:40:02.000Z"),
      ],
      percentDisplayMode: "remaining",
    });

    expect(outputs.sidebar).toBe("OpenCode Go           5h  3.0h  100%");
  });

  it("shows remaining 0% for a rate-limited window without hiding healthy siblings", () => {
    const outputs = renderAccountingSurfaces({
      data: { entries: exhaustedWeeklyEntries, errors: [] },
      accountingDetail: "summary",
      showMaxWidth: 64,
      showNarrowAt: 44,
    });

    for (const output of [outputs.command, outputs.show]) {
      expect(output).toContain("OpenCode Go");
      expect(output).toContain("0%");
      expect(output).toContain("83%");
      expect(output).toContain("9%");
    }
    expect(outputs.sidebar).toContain("OpenCode Go");
    expect(outputs.sidebar).toContain("7d");
    expect(outputs.sidebar).toContain("0%");
    expect(outputs.sidebar).not.toContain("83%");
    expect(outputs.sidebar).not.toContain("9%");
    expect(outputs.command).toMatch(/Week quota[\s\S]*0% left/u);
  });

  it("shows used 100% for a rate-limited window on command, show, and sidebar", () => {
    const outputs = renderSurfaces({
      entries: exhaustedWeeklyEntries,
      percentDisplayMode: "used",
    });

    for (const output of [outputs.command, outputs.show]) {
      expect(output).toContain("OpenCode Go");
      expect(output).toContain("100%");
      expect(output).toContain("17%");
      expect(output).toContain("91%");
    }
    expect(outputs.sidebar).toContain("7d");
    expect(outputs.sidebar).toContain("100%");
    expect(outputs.sidebar).not.toContain("17%");
    expect(outputs.sidebar).not.toContain("91%");
    expect(outputs.command).toMatch(/Week quota[\s\S]*100% used/u);
  });

  it("renders only selected windows after provider filtering", () => {
    const selected = exhaustedWeeklyEntries.filter((entry) => entry.label !== "Weekly:");
    const remaining = renderAccountingSurfaces({
      data: { entries: selected, errors: [] },
      accountingDetail: "summary",
      showMaxWidth: 64,
      showNarrowAt: 44,
    });

    for (const output of [remaining.command, remaining.show]) {
      expect(output).toContain("83%");
      expect(output).toContain("9%");
      expect(output).not.toMatch(/\b7d\b/u);
      expect(output).not.toMatch(/Week(?:ly)?/u);
    }
    expect(remaining.sidebar).toContain("30d");
    expect(remaining.sidebar).toContain("9%");
    expect(remaining.sidebar).not.toContain("83%");
    expect(remaining.sidebar).not.toMatch(/\b7d\b/u);
    expect(remaining.sidebar).not.toMatch(/Week(?:ly)?/u);
  });
});
