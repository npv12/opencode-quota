import { afterEach, describe, expect, it, vi } from "vitest";

import type { QuotaPercentEntry } from "../src/lib/entries.js";
import { formatQuotaRows } from "../src/lib/format.js";
import { formatQuotaCommand } from "../src/lib/quota-command-format.js";
import type { QuotaRenderData } from "../src/lib/quota-render-data.js";
import {
  buildSidebarQuotaPanelLines,
  TUI_SIDEBAR_MAX_WIDTH,
} from "../src/lib/tui-sidebar-format.js";

const NOW_ISO = "2026-09-09T10:00:00.000Z";
const RESET_ISO = "2026-09-09T12:00:00.000Z";

function percentEntry(overrides: Partial<QuotaPercentEntry> = {}): QuotaPercentEntry {
  return {
    accounting: {
      resultType: "quota",
      acquisitionMethod: "remote_api",
      ownership: "maintained",
      authority: "provider_reported",
      observedAtIso: NOW_ISO,
    },
    name: "OpenAI Five-hour",
    group: "OpenAI Account With A Very Long Provider Label",
    label: "Five-hour:",
    percentRemaining: 50,
    resetTimeIso: RESET_ISO,
    runway: { kind: "before_reset", projectedAtIso: "2026-09-09T11:50:00.000Z" },
    ...overrides,
  };
}

function data(entries: QuotaPercentEntry[]): QuotaRenderData {
  return { entries, errors: [] };
}

function renderShow(entries: QuotaPercentEntry[], percentDisplayMode: "remaining" | "used") {
  return formatQuotaRows({
    version: "test",
    style: "allWindows",
    layout: { maxWidth: 52, narrowAt: 42, tinyAt: 32 },
    entries,
    errors: [],
    percentDisplayMode,
  });
}

describe("quota runway production surfaces", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows exact full-label typography and keeps reset separate on /quota and show", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
    const entries = [percentEntry()];

    const command = formatQuotaCommand({
      ...data(entries),
      generatedAtMs: Date.parse(NOW_ISO),
      percentDisplayMode: "remaining",
    });
    const show = renderShow(entries, "remaining");

    for (const output of [command, show]) {
      expect(output).toContain("Runs out");
      expect(output).toContain("≈ 1h 50m");
      expect(output).toContain("2h");
      expect(output).not.toContain("≈1h");
      expect(output).not.toContain("1h50m");
    }
    expect(command).toMatch(/reset 2h0m \| Runs out ≈ 1h 50m/u);
  });

  it("keeps the same runway in used and remaining modes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
    const entries = [percentEntry({ percentRemaining: 75 })];

    const remaining = renderShow(entries, "remaining");
    const used = renderShow(entries, "used");

    expect(remaining).toContain("75% left");
    expect(used).toContain("25% used");
    expect(remaining).toContain("Runs out  ≈ 1h 50m");
    expect(used).toContain("Runs out  ≈ 1h 50m");
  });

  it("keeps runway readable and bounded in the tiny show layout", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));

    const tiny = formatQuotaRows({
      version: "test",
      style: "allWindows",
      layout: { maxWidth: 30, narrowAt: 42, tinyAt: 32 },
      entries: [percentEntry({ name: "OpenAI Five-hour", group: "OpenAI" })],
      errors: [],
      percentDisplayMode: "remaining",
    });

    expect(tiny).toContain("Runs out");
    expect(tiny).toContain("≈ 1h 50m");
    for (const line of tiny.split("\n")) expect([...line].length).toBeLessThanOrEqual(30);
  });

  it("renders the canonical provider and compact window within the 36-column sidebar", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));

    const lines = buildSidebarQuotaPanelLines({
      data: data([percentEntry()]),
      config: { percentDisplayMode: "remaining" },
    });

    expect(lines.join("\n")).toContain("OpenAI");
    expect(lines.join("\n")).toContain("5h");
    expect(lines.join("\n")).toContain("50%");
    expect(lines).toHaveLength(1);
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(TUI_SIDEBAR_MAX_WIDTH);
  });

  it("matches independent default-off outputs when entries have no projection", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
    const entries = [percentEntry({ runway: undefined })];
    const command = formatQuotaCommand({ ...data(entries), generatedAtMs: Date.parse(NOW_ISO) });

    expect({
      command: command.slice(command.indexOf("\n\n") + 2),
      show: renderShow(entries, "remaining"),
      sidebar: buildSidebarQuotaPanelLines({
        data: data(entries),
        config: { percentDisplayMode: "remaining" },
      }),
    }).toEqual({
      command:
        "→ [OpenAI Account With A Very Long Provider Label]\n  5h quota      █████░░░░░   50% left | reset 2h0m",
      show: "[OpenAI Account With A Very Long Provider Label]\n5h                                              2h0m\n█████████████████████░░░░░░░░░░░░░░░░░░░░   50% left",
      sidebar: ["OpenAI                5h  2.0h   50%"],
    });
  });
});
