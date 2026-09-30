import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountingWindow, QuotaPercentEntry, QuotaToastEntry } from "../src/lib/entries.js";
import {
  buildSidebarQuotaPanelLines,
  TUI_SIDEBAR_MAX_WIDTH,
} from "../src/lib/tui-sidebar-format.js";
import { DEFAULT_CONFIG } from "../src/lib/types.js";

const accounting = {
  resultType: "quota",
  acquisitionMethod: "remote_api",
  ownership: "maintained",
  authority: "provider_reported",
} as const;

function percent(overrides: Partial<QuotaPercentEntry> = {}): QuotaPercentEntry {
  return {
    accounting,
    name: "OpenAI",
    group: "OpenAI",
    label: "5h",
    percentRemaining: 80,
    ...overrides,
  };
}

function render(entries: QuotaToastEntry[], config = DEFAULT_CONFIG): string[] {
  return buildSidebarQuotaPanelLines({ data: { entries, errors: [] }, config });
}

describe("buildSidebarQuotaPanelLines", () => {
  afterEach(() => vi.useRealTimers());

  it("renders headerless provider/window/reset/value rows without bars", () => {
    const lines = render([percent()]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^OpenAI\s+5h\s+80%$/u);
    expect(lines.join("\n")).not.toMatch(/Provider|Window|Reset|Value/u);
    expect(lines.join("\n")).not.toMatch(/[█░]/u);
  });

  it.each([
    ["[Claude Claude: personal@example.test]", "Claude"],
    ["[Anthropic Work] (active)", "Anthropic"],
    ["[OpenAI personal] (Plus) (active)", "OpenAI"],
    ["[Google AGY Antigravity CLI (plugin)]", "Google AGY"],
    ["AGY (personal): Claude/GPT", "Antigravity"],
    ["[xAI personal] (SuperGrok) (active)", "xAI"],
    ["Copilot (business)", "Copilot"],
    ["Cursor (Pro)", "Cursor"],
    ["OpenCode Go (monthly)", "OpenCode Go"],
    ["OpenCode Zenith", "OpenCode Zenith"],
    ["OpenAIish", "OpenAIish"],
    ["Custom gateway", "Custom gateway"],
  ])("uses a short provider label for %s", (group, provider) => {
    const lines = render([percent({ group })]);
    expect(
      lines
        .map((line) => line.slice(0, 13).trim())
        .filter(Boolean)
        .join(" "),
    ).toBe(provider);
    expect(lines[0]!.slice(14).trim()).toMatch(/^5h\s+80%$/u);
  });

  it.each(["OpenCode Zen", "[OpenCode Zen] (Work)"])("hides %s rows and errors", (group) => {
    const lines = buildSidebarQuotaPanelLines({
      config: DEFAULT_CONFIG,
      data: {
        entries: [
          percent({ group }),
          {
            accounting: { ...accounting, resultType: "balance" },
            name: "OpenCode Zen",
            group,
            kind: "quantity",
            quantity: { decimal: "20.40", unit: { kind: "currency", code: "USD" } },
            semantic: {
              metric: { kind: "component", component: "current_balance" },
              prominence: "primary",
            },
          },
        ],
        errors: [{ label: group, message: "Could not fetch quota" }],
      },
    });
    expect(lines).toEqual([]);
  });

  it("keeps OpenCode Go when OpenCode Zen is hidden", () => {
    const lines = render([percent({ group: "OpenCode Zen" }), percent({ group: "OpenCode Go" })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^OpenCode Go\s+5h\s+80%$/u);
  });

  it("sorts by displayed provider name regardless of input order without mutating entries", () => {
    const entries = [
      percent({ group: "[xAI personal] (SuperGrok)" }),
      percent({ group: "[OpenAI personal] (Plus)" }),
      percent({ group: "Google AGY (personal)" }),
      percent({ group: "AGY (personal)" }),
      percent({ group: "[Claude personal]" }),
    ];
    const original = structuredClone(entries);
    const lines = render(entries);

    expect(lines.map((line) => line.slice(0, 13).trim())).toEqual([
      "Antigravity",
      "Claude",
      "Google AGY",
      "OpenAI",
      "xAI",
    ]);
    expect(render([...entries].reverse())).toEqual(lines);
    expect(entries).toEqual(original);
  });

  it("puts budget, balance and spend providers last and alphabetizes both sections", () => {
    const lines = render([
      percent({ group: "OpenRouter", accounting: { ...accounting, resultType: "budget" } }),
      percent({ group: "xAI" }),
      {
        accounting: { ...accounting, resultType: "balance" },
        name: "DeepSeek",
        group: "DeepSeek",
        kind: "quantity",
        quantity: { decimal: "20.40", unit: { kind: "currency", code: "USD" } },
        semantic: { metric: { kind: "aggregate" }, prominence: "primary" },
      },
      percent({ group: "OpenAI" }),
      {
        accounting: { ...accounting, resultType: "spend" },
        name: "Aggregator",
        group: "Aggregator",
        kind: "value",
        value: "$3.00",
      },
      percent({
        group: "Cursor",
        label: "Monthly",
        accounting: { ...accounting, resultType: "budget" },
      }),
      percent({ group: "Claude" }),
    ]);

    expect(lines.map((line) => line.slice(0, 13).trim())).toEqual([
      "Claude",
      "OpenAI",
      "xAI",
      "Aggregator",
      "Cursor",
      "DeepSeek",
      "OpenRouter",
    ]);
    expect(lines.every((line) => line.length === TUI_SIDEBAR_MAX_WIDTH)).toBe(true);
  });

  it("keeps mixed financial provider rows together in the budget section", () => {
    const lines = render([
      percent(),
      {
        accounting: { ...accounting, resultType: "balance" },
        name: "OpenAI balance",
        group: "OpenAI",
        kind: "quantity",
        quantity: { decimal: "2.50", unit: { kind: "currency", code: "USD" } },
        semantic: { metric: { kind: "aggregate" }, prominence: "primary" },
      },
      percent({ group: "xAI" }),
    ]);

    expect(lines.map((line) => line.slice(0, 13).trim())).toEqual(["xAI", "OpenAI", "OpenAI"]);
    expect(lines[1]).toContain("80%");
    expect(lines[2]).toContain("USD 2.50");
  });

  it("sorts provider errors alphabetically without changing their labels", () => {
    const lines = buildSidebarQuotaPanelLines({
      config: DEFAULT_CONFIG,
      data: {
        entries: [],
        errors: [
          { label: "xAI (Work)", message: "Could not fetch" },
          { label: "[OpenAI Work]", message: "Could not fetch" },
          { label: "Claude", message: "Could not fetch" },
        ],
      },
    });

    expect(lines).toEqual([
      "Claude: Could not fetch",
      "[OpenAI Work]: Could not fetch",
      "xAI (Work): Could not fetch",
    ]);
  });

  it("keeps simple provider names left and compact quota details right", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));
    const lines = render([
      percent({
        group: "[Claude Claude: personal@example.test]",
        label: "Weekly:",
        percentRemaining: 74,
        resetTimeIso: "2026-01-19T16:03:00.000Z",
      }),
      percent({
        group: "[OpenAI] (Plus)",
        percentRemaining: 53,
        resetTimeIso: "2026-01-15T13:21:00.000Z",
      }),
      percent({
        group: "OpenRouter",
        label: "Budget",
        percentRemaining: 8,
        accounting: { ...accounting, resultType: "budget" },
      }),
      percent({
        group: "[Google AGY Antigravity CLI (plugin)]",
        label: "Weekly:",
        percentRemaining: 61,
        resetTimeIso: "2026-01-16T03:14:00.000Z",
      }),
      percent({
        group: "[xAI] (SuperGrok)",
        label: "Weekly:",
        percentRemaining: 99,
        resetTimeIso: "2026-01-20T07:44:00.000Z",
      }),
    ]);
    expect(lines).toEqual([
      "Claude                7d  4.3d   74%",
      "Google AGY            7d 17.2h   61%",
      "OpenAI                5h  3.4h   53%",
      "xAI                   7d  4.9d   99%",
      "OpenRouter                        8%",
    ]);
    expect(lines.every((line) => line.length <= TUI_SIDEBAR_MAX_WIDTH)).toBe(true);
  });

  it.each([
    ["5h", 8, "2026-01-15T10:01:00.000Z", "5h", "1m"],
    ["Weekly", 80, "2026-01-15T22:18:00.000Z", "7d", "12.3h"],
    ["Yearly", 100, "2026-01-18T07:36:00.000Z", "365d", "2.9d"],
    ["5h", 80, undefined, "5h", ""],
    ["Budget", 80, "2026-01-15T12:54:00.000Z", "", "2.9h"],
    ["Budget", 80, "invalid", "", ""],
  ] as const)("keeps fixed columns for %s at %s percent", (label, percentRemaining, resetTimeIso, window, reset) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));
    const line = render([percent({ label, percentRemaining, resetTimeIso })])[0]!;
    expect(line).toHaveLength(TUI_SIDEBAR_MAX_WIDTH);
    expect(line.slice(0, 13)).toBe("OpenAI       ");
    expect(line.slice(14, 20)).toBe(" ".repeat(6));
    expect(line.slice(20, 24)).toBe(window.padStart(4));
    expect(line.slice(25, 30)).toBe(reset.padStart(5));
    expect(line.slice(31, 36)).toBe(`${percentRemaining}%`.padStart(5));
    expect([line[13], line[24], line[30]]).toEqual([" ", " ", " "]);
  });

  it("reserves extra percentage padding without moving time columns at 100 percent", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));
    const lines = [8, 80, 100].map(
      (percentRemaining) =>
        render([percent({ percentRemaining, resetTimeIso: "2026-01-15T12:54:00.000Z" })])[0]!,
    );

    expect(lines.map((line) => line.slice(0, 31))).toEqual(Array(3).fill(lines[0]!.slice(0, 31)));
    expect(lines.map((line) => line.indexOf("2.9h"))).toEqual([26, 26, 26]);
    expect(lines.every((line) => line.length === TUI_SIDEBAR_MAX_WIDTH)).toBe(true);
    expect(lines.every((line) => line.slice(30, 32) === "  ")).toBe(true);
    expect(lines[2]).toMatch(/2\.9h {2}100%$/u);
  });

  it("does not resize columns when other rows appear, disappear or reorder", () => {
    const entry = percent();
    const balance: QuotaToastEntry = {
      accounting: { ...accounting, resultType: "balance" },
      name: "Custom gateway",
      group: "Custom gateway with a long name",
      kind: "quantity",
      quantity: { decimal: "1234567890.12", unit: { kind: "currency", code: "USD" } },
      semantic: { metric: { kind: "aggregate" }, prominence: "primary" },
    };
    const [expected] = render([entry]);
    expect(render([entry, balance])[0]).toBe(expected);
    expect(render([balance, entry])[0]).toBe(expected);
    expect(render([entry])[0]).toBe(expected);
    const balanceLines = render([balance]);
    expect(balanceLines.every((line) => line.length === TUI_SIDEBAR_MAX_WIDTH)).toBe(true);
    expect(balanceLines.every((line) => line.slice(13, 25) === " ".repeat(12))).toBe(true);
    expect(balanceLines.map((line) => line.slice(25).trim()).join("")).toBe("USD1,234,567,890.12");
  });

  it("selects the least remaining window within each account group", () => {
    const lines = render([
      percent({ group: "Personal", label: "5h", percentRemaining: 80 }),
      percent({ group: "Personal", label: "Weekly", percentRemaining: 15 }),
      percent({ group: "Work", label: "5h", percentRemaining: 30 }),
      percent({ group: "Work", label: "Weekly", percentRemaining: 90 }),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Personal\s+7d\s+15%$/u);
    expect(lines[1]).toMatch(/^Work\s+5h\s+30%$/u);
  });

  it("does not let balance rows wrap other provider names", () => {
    const lines = render([
      percent({ group: "OpenRouter" }),
      percent({ group: "Google AGY" }),
      {
        accounting: { ...accounting, resultType: "balance" },
        name: "DeepSeek",
        group: "DeepSeek",
        kind: "quantity",
        quantity: { decimal: "20.40", unit: { kind: "currency", code: "USD" } },
        semantic: { metric: { kind: "named", name: "Current balance" }, prominence: "primary" },
      },
    ]);
    expect(lines[0]).toMatch(/^Google AGY\s+5h\s+80%$/u);
    expect(lines[1]).toMatch(/^OpenRouter\s+5h\s+80%$/u);
    expect(lines[2]).toMatch(/^DeepSeek\s/u);
    expect(lines[2]).toContain("USD 20.40");
    expect(lines.join("\n")).not.toContain("Current balance");
    expect(lines.every((line) => line.length <= TUI_SIDEBAR_MAX_WIDTH)).toBe(true);
  });

  it("does not merge accounts after shortening their display names", () => {
    const entries = [
      percent({ group: "[OpenAI personal] (Plus)", label: "5h", percentRemaining: 80 }),
      percent({ group: "[OpenAI personal] (Plus)", label: "Weekly", percentRemaining: 15 }),
      percent({ group: "[OpenAI work] (Pro)", label: "5h", percentRemaining: 30 }),
      percent({ group: "[OpenAI work] (Pro)", label: "Weekly", percentRemaining: 90 }),
    ];
    const originalGroups = entries.map((entry) => entry.group);
    const lines = render(entries);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^OpenAI\s+7d\s+15%$/u);
    expect(lines[1]).toMatch(/^OpenAI\s+5h\s+30%$/u);
    expect(entries.map((entry) => entry.group)).toEqual(originalGroups);
  });

  it("does not merge separate sources sharing a display group", () => {
    const lines = render([
      percent({ accounting: { ...accounting, sourceId: "a" }, percentRemaining: 10 }),
      percent({ accounting: { ...accounting, sourceId: "b" }, percentRemaining: 20 }),
      percent({ accounting: { ...accounting, sourceId: "a" }, percentRemaining: 90 }),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("10%");
    expect(lines[1]).toContain("20%");
  });

  it("keeps a stable first window for ties and ignores nonfinite percentages", () => {
    const lines = render([
      percent({ label: "5h", percentRemaining: 20 }),
      percent({ label: "Weekly", percentRemaining: 20 }),
      percent({ label: "Monthly", percentRemaining: Number.NaN }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/\s5h\s/u);
    expect(lines.join("\n")).not.toContain("NaN");
  });

  it("selects by remaining quota even when displaying used percentages", () => {
    const lines = render(
      [
        percent({ label: "5h", percentRemaining: 90 }),
        percent({ label: "Weekly", percentRemaining: 10 }),
      ],
      { ...DEFAULT_CONFIG, percentDisplayMode: "used" },
    );
    expect(lines[0]).toContain("7d");
    expect(lines[0]).toMatch(/\s90%$/u);
  });

  it("preserves over-quota used values and clamps negative remaining labels", () => {
    expect(render([percent({ percentRemaining: -25 })]).join("\n")).toMatch(/\s0%$/u);
    expect(
      render([percent({ percentRemaining: -25 })], {
        ...DEFAULT_CONFIG,
        percentDisplayMode: "used",
      }).join("\n"),
    ).toMatch(/\s125%$/u);
  });

  it("uses bare percentages regardless of report label style", () => {
    const lines = render([percent()], { ...DEFAULT_CONFIG, percentLabelStyle: "full" });
    expect(lines[0]).toMatch(/\s80%$/u);
    expect(lines.join("\n")).not.toContain("left");
  });

  it("formats typed quantities and booleans without inventing percentages", () => {
    const entries: QuotaToastEntry[] = [
      {
        accounting: { ...accounting, resultType: "balance" },
        name: "DeepSeek",
        group: "DeepSeek",
        kind: "quantity",
        quantity: { decimal: "25.255", unit: { kind: "currency", code: "USD" } },
        semantic: { metric: { kind: "aggregate" }, prominence: "primary" },
      },
      {
        accounting: { ...accounting, resultType: "status" },
        name: "DeepSeek",
        group: "DeepSeek",
        kind: "boolean",
        value: false,
        semantic: { metric: { kind: "named", name: "Availability" }, prominence: "primary" },
      },
    ];
    const text = render(entries).join("\n");
    expect(text).toContain("USD 25.26");
    expect(text).toContain("Low balance");
    expect(text).not.toContain("%");
    expect(text).not.toContain("undefined");
  });

  it("retains nonpercentage rows alongside the limiting window", () => {
    const lines = render([
      percent(),
      { ...percent(), kind: "value", value: "$3.00", label: "Balance" },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("80%");
    expect(lines[1]).toContain("$3.00");
  });

  it("wraps the Copilot billing-token message without truncating it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T08:00:00.000Z"));
    const value = "business | usage needs billing token";
    const lines = render([
      {
        accounting: { ...accounting, resultType: "status" },
        name: "Copilot",
        group: "Copilot (business)",
        kind: "value",
        label: "Plan:",
        value,
        resetTimeIso: "2026-10-01T00:00:00.000Z",
      },
    ]);

    expect(lines.every((line) => line.length === TUI_SIDEBAR_MAX_WIDTH)).toBe(true);
    expect(lines[0]).toMatch(/^Copilot\s/u);
    expect(lines.map((line) => line.slice(25).trim()).join(" ")).toBe(value);
  });

  it("uses semantic window labels rather than provider-specific row prose", () => {
    const lines = render([
      percent({
        label: "Plan usage",
        semantic: { metric: { kind: "window", window: "week" }, prominence: "primary" },
      }),
    ]);
    expect(lines[0]).toContain("7d");
    expect(lines.join("\n")).not.toContain("Plan usage");
  });

  it.each<[AccountingWindow, string]>([
    ["rpm", ""],
    ["hour", "1h"],
    ["five_hour", "5h"],
    ["day", "1d"],
    ["week", "7d"],
    ["month", "30d"],
    ["year", "365d"],
    ["mcp", ""],
    ["code_review", ""],
  ])("uses a compact semantic %s window", (window, label) => {
    const line = render([
      percent({ semantic: { metric: { kind: "window", window }, prominence: "primary" } }),
    ])[0]!;
    expect(line.trim().split(/\s+/u)).toEqual(["OpenAI", ...(label ? [label] : []), "80%"]);
  });

  it.each([
    ["Hourly:", "1h"],
    ["Five-hour:", "5h"],
    ["Daily:", "1d"],
    ["Weekly:", "7d"],
    ["Monthly:", "30d"],
    ["Yearly:", "365d"],
    ["3h:", "3h"],
    ["4h:", "4h"],
    ["30d:", "30d"],
    ["0.5h:", "0.5h"],
  ])("uses a compact legacy %s window", (label, window) => {
    expect(render([percent({ label })])[0]).toContain(` ${window} `);
  });

  it("omits named metrics instead of guessing a window from duration words", () => {
    const text = render([
      percent({
        semantic: { metric: { kind: "named", name: "Fable weekly" }, prominence: "primary" },
      }),
    ]).join("\n");
    expect(text).not.toContain("Fable weekly");
    expect(text).not.toContain("7d");
    expect(text).toMatch(/^OpenAI\s+80%$/u);
  });

  it.each([
    "Budget",
    "Current balance",
    "Credits",
    "Availability",
    "MCP",
    "Code Review",
  ])("omits non-time label %s", (label) => {
    const lines = render([percent({ label })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^OpenAI\s+80%$/u);
  });

  it.each([
    ["2026-01-15T12:54:00.000Z", "2.9h"],
    ["2026-01-18T07:36:00.000Z", "2.9d"],
    ["2026-01-15T10:30:00.000Z", "0.5h"],
    ["2026-01-15T10:01:00.000Z", "1m"],
    ["2026-01-15T09:59:00.000Z", ""],
    ["invalid", ""],
    [undefined, ""],
  ])("uses a compact one-decimal countdown for %s", (resetTimeIso, countdown) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));
    expect(
      render([percent({ resetTimeIso })])[0]!
        .trim()
        .split(/\s+/u),
    ).toEqual(["OpenAI", "5h", ...(countdown ? [countdown] : []), "80%"]);
  });

  it("keeps sidebar countdowns compact regardless of report reset settings", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));
    const entries = [percent({ resetTimeIso: "2026-01-15T12:14:00.000Z" })];
    const lines = render(entries);
    expect(lines[0]).toMatch(/\s2\.2h\s+80%$/u);
    expect(render(entries, { ...DEFAULT_CONFIG, resetTimeSpaced: false })).toEqual(lines);
    expect(render(entries, { ...DEFAULT_CONFIG, resetTimeDecimals: 4 })).toEqual(lines);
  });

  it("wraps long custom provider labels without dropping text", () => {
    const lines = render([percent({ group: "Custom gateway personal@example.test" })]);
    expect(lines.every((line) => line.length <= TUI_SIDEBAR_MAX_WIDTH)).toBe(true);
    const windowStart = lines[0]!.indexOf("5h");
    const provider = lines
      .map((line) => line.slice(0, windowStart - 1).trim())
      .filter(Boolean)
      .join("");
    expect(provider.replace(/\s/gu, "")).toBe("Customgatewaypersonal@example.test");
    expect(lines[0]).toContain("80%");
  });

  it("sanitizes untrusted row and error text", () => {
    const lines = buildSidebarQuotaPanelLines({
      config: DEFAULT_CONFIG,
      data: {
        entries: [percent({ group: "OpenAI\u001b[31m", label: "5h\u0007" })],
        errors: [{ label: "Err\u001b[33m", message: "Bad\u0003" }],
      },
    });
    for (const code of [0x1b, 0x07, 0x03]) {
      expect(lines.join("\n")).not.toContain(String.fromCharCode(code));
    }
    expect(lines.join("\n")).toContain("Err: Bad");
  });

  it("renders wrapped errors without quota rows or a misleading table header", () => {
    const message = "Could not parse OpenCode Console budgets/org response";
    const lines = buildSidebarQuotaPanelLines({
      config: DEFAULT_CONFIG,
      data: { entries: [], errors: [{ label: "Custom gateway", message }] },
    });
    expect(lines.join(" ")).toBe(`Custom gateway: ${message}`);
    expect(lines.every((line) => line.length <= TUI_SIDEBAR_MAX_WIDTH)).toBe(true);
    expect(lines.join("\n")).not.toContain("Provider");
  });

  it("omits session token data from the sidebar", () => {
    const lines = buildSidebarQuotaPanelLines({
      config: DEFAULT_CONFIG,
      data: {
        entries: [],
        errors: [],
        sessionTokens: {
          totalInput: 372,
          totalCachedInput: 120,
          totalOutput: 41,
          models: [{ modelID: "openai/gpt-5.4-mini", input: 372, cachedInput: 120, output: 41 }],
        },
      },
    });
    expect(lines).toEqual([]);
  });

  it("returns no rows for empty data", () => expect(render([])).toEqual([]));
});
