/**
 * The fork's minimal sidebar: a "Quota" title, then one line per provider and row, without bars
 * or session tokens. Names sit on the left; the window, reset and percent are right-aligned. The
 * percent keeps the theme's level color, so limits stay readable.
 */
import type { QuotaSnapshot, QuotaWindow, Words } from "../core/types.js";
import type { Settings } from "../settings/schema.js";
import { columnsOf } from "./columns.js";
import { fit } from "./format.js";
import { errorWords, type Place, type RowFacts, rowFacts } from "./row-facts.js";
import { type Group, type VisibleRow, visibleGroups } from "./select.js";
import type { Line, Segment } from "./text.js";

export const MINIMAL_SIDEBAR_WIDTH = 36;
const GAP = "  ";

const BUDGET_TYPES: ReadonlySet<string> = new Set(["balance", "budget", "status", "usage"]);
/** Providers the sidebar never shows. `opencode` is OpenCode Zen. */
const HIDDEN_PROVIDERS: ReadonlySet<string> = new Set(["opencode", "opencode-zen"]);

const WINDOW_SHORT: Readonly<Partial<Record<QuotaWindow, string>>> = {
  rpm: "RPM",
  hour: "1h",
  five_hour: "5h",
  session: "5h",
  day: "1d",
  week: "7d",
  month: "30d",
  year: "365d",
};

function place(words: Words, nowMs: number): Place {
  return {
    words,
    nowMs,
    names: "words",
    percent: "words",
    evenUse: false,
  };
}

/** The provider's name without its plan or account, which the row already shows. */
function providerLabel(group: Group): string {
  return group.title.replace(/\s*\([^)]*\)\s*$/u, "");
}

/** A row's window as "5h", "7d" or "30d"; blank for a budget, balance or other value row. */
function windowLabel(item: VisibleRow): string {
  if (item.row.window) return WINDOW_SHORT[item.row.window] ?? "";
  if (BUDGET_TYPES.has(item.row.type)) return "";
  const label = item.label.toLowerCase();
  if (/\bweekly?\b/u.test(label)) return "7d";
  if (/\bmonth(?:ly)?\b/u.test(label)) return "30d";
  if (/\bday(?:ly)?\b/u.test(label)) return "1d";
  if (/\bhour(?:ly)?\b/u.test(label)) return "1h";
  if (/\b5[\s-]?h(?:our)?s?\b/u.test(label)) return "5h";
  return "";
}

type ShownRow = { facts: RowFacts; provider: string; window: string };

/** The limiting percent row of a group, plus every row without a percent. */
function shownRows(group: Group, words: Words, nowMs: number): ShownRow[] {
  const rows = group.rows.map((row) => ({
    row,
    facts: rowFacts(row, group, place(words, nowMs)),
  }));
  const lowest = rows
    .filter(({ facts }) => facts.percent !== undefined)
    .reduce<RowFacts | undefined>(
      (best, { facts }) => (!best || facts.percent! < best.percent! ? facts : best),
      undefined,
    );
  return rows
    .filter(({ facts }) => (facts.percent === undefined ? facts.value !== "" : facts === lowest))
    .map(({ row, facts }) => ({
      facts,
      provider: providerLabel(group),
      window: windowLabel(row),
    }));
}

function groupSortKey(group: Group): [number, string, string] {
  const budget = group.rows.some((row) => BUDGET_TYPES.has(row.row.type)) ? 1 : 0;
  return [budget, providerLabel(group).toLocaleLowerCase(), group.title.toLocaleLowerCase()];
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/u)) {
    const next = line ? `${line} ${word}` : word;
    if (line && columnsOf(next) > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

function pad(text: string, width: number, align: "left" | "right"): string {
  return align === "left" ? text.padEnd(width) : text.padStart(width);
}

type Widths = { provider: number; window: number; reset: number; value: number };

function rowWidths(rows: ShownRow[]): Widths {
  const percentRows = rows.filter((row) => row.facts.percent !== undefined);
  const window = Math.max(0, ...rows.map((row) => columnsOf(row.window)));
  const reset = Math.max(0, ...percentRows.map((row) => columnsOf(row.facts.reset)));
  const value = Math.max(0, ...rows.map((row) => columnsOf(row.facts.value)));
  // Two spaces before the numeric block, which has two between its columns.
  const numeric =
    (window > 0 ? window + GAP.length : 0) + (reset > 0 ? reset + GAP.length : 0) + value;
  const provider = Math.max(1, MINIMAL_SIDEBAR_WIDTH - 2 - GAP.length - numeric);
  return { provider, window, reset, value };
}

/** The right-hand block: window, reset and value, each right-aligned. */
function numericBlock(row: ShownRow, widths: Widths): Segment[] {
  const segments: Segment[] = [];
  if (widths.window > 0) {
    segments.push(
      { text: pad(fit(row.window, widths.window), widths.window, "right"), role: "value" },
      { text: GAP, role: "label" },
    );
  }
  if (widths.reset > 0) {
    segments.push(
      {
        text: pad(row.facts.percent === undefined ? "" : row.facts.reset, widths.reset, "right"),
        role: "reset",
      },
      { text: GAP, role: "label" },
    );
  }
  segments.push({
    text: pad(row.facts.value, widths.value, "right"),
    role: row.facts.percent === undefined ? "value" : "percent",
    ...(row.facts.percent === undefined ? {} : { percent: row.facts.percent }),
  });
  return segments;
}

function rowLine(group: Group, row: ShownRow, widths: Widths): Line {
  const segments: Segment[] = [
    { text: "  ", role: "label" },
    {
      text: pad(fit(row.provider, widths.provider), widths.provider, "left"),
      role: "provider",
    },
    { text: GAP, role: "label" },
    ...numericBlock(row, widths),
  ];
  return { id: group.id, segments };
}

function errorLines(group: Group, _words: Words, nowMs: number): Line[] {
  const text = errorWords(group, nowMs);
  if (!text) return [];
  return wrap(`${providerLabel(group)}: ${text}`, MINIMAL_SIDEBAR_WIDTH - 2).map((line) => ({
    id: group.providerId,
    segments: [
      { text: "  ", role: "label" },
      { text: line, role: "error" },
    ],
  }));
}

export function minimalSidebarLines(input: {
  snapshot: QuotaSnapshot | undefined;
  settings: Settings;
  nowMs: number;
}): Line[] {
  if (!input.snapshot) return [];
  const words: Words = {
    ...(input.snapshot.words ?? input.settings.words),
    percent: "bare",
    reset: "decimal",
    resetDecimals: 1,
    rowNames: "short",
  };
  const groups = visibleGroups(input.snapshot, input.settings, "sidebar", words)
    .filter((group) => !HIDDEN_PROVIDERS.has(group.providerId))
    .sort((left, right) => {
      const [leftBudget, leftName, leftTitle] = groupSortKey(left);
      const [rightBudget, rightName, rightTitle] = groupSortKey(right);
      return (
        leftBudget - rightBudget ||
        leftName.localeCompare(rightName) ||
        leftTitle.localeCompare(rightTitle)
      );
    });
  const shown = groups.map((group) => ({
    group,
    rows: shownRows(group, words, input.nowMs),
  }));
  const widths = rowWidths(shown.flatMap((item) => item.rows));
  const content: Line[] = [];
  for (const { group, rows } of shown) {
    for (const row of rows) content.push(rowLine(group, row, widths));
    content.push(...errorLines(group, words, input.nowMs));
  }
  return content;
}
