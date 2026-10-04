import { interpretAccountingRow } from "./accounting-format.js";
import { sanitizeQuotaRenderData } from "./display-sanitize.js";
import {
  type AccountingWindow,
  isPercentEntry,
  type QuotaPercentEntry,
  type QuotaToastEntry,
} from "./entries.js";
import {
  displayedPercentLabelWidth,
  formatDisplayedPercentLabel,
  formatResetCountdown,
  wrapDisplayText,
} from "./format-utils.js";
import { groupQuotaEntries } from "./grouped-entry-normalization.js";
import { QUOTA_PROVIDER_LABELS } from "./provider-metadata.js";
import { classifyQuotaWindowText, normalizeSingleWindowLabelText } from "./quota-entry-display.js";
import type { QuotaRenderData } from "./quota-render-data.js";
import type { QuotaToastConfig } from "./types.js";

export const TUI_SIDEBAR_MAX_WIDTH = 36;

const SIDEBAR_COLUMN_WIDTHS = [13, 4, 5, 11] as const;

const SIDEBAR_PROVIDER_LABELS = [
  "Claude",
  "AGY",
  ...new Set(Object.values(QUOTA_PROVIDER_LABELS)),
].sort((left, right) => right.length - left.length);

const SIDEBAR_WINDOW_LABELS: Readonly<Record<AccountingWindow, string>> = {
  rpm: "",
  hour: "1h",
  five_hour: "5h",
  day: "1d",
  week: "7d",
  month: "30d",
  year: "365d",
  mcp: "",
  code_review: "",
};

function formatSidebarProviderLabel(group: string): string {
  const name = group.replace(/\[([^\]]+)\]/gu, "$1");
  const provider = SIDEBAR_PROVIDER_LABELS.find(
    (label) =>
      name === label || (name.startsWith(label) && /^[\s:(]/u.test(name.slice(label.length))),
  );
  if (provider === "AGY") return "Antigravity";
  return provider ?? name;
}

function selectSidebarEntries(entries: QuotaToastEntry[]): QuotaToastEntry[] {
  const selectedBySource = new Map<string | undefined, QuotaPercentEntry>();
  for (const entry of entries) {
    if (!isPercentEntry(entry) || !Number.isFinite(entry.percentRemaining)) continue;
    const selected = selectedBySource.get(entry.accounting.sourceId);
    if (!selected || entry.percentRemaining < selected.percentRemaining) {
      selectedBySource.set(entry.accounting.sourceId, entry);
    }
  }
  return entries.filter((entry) =>
    isPercentEntry(entry) ? selectedBySource.get(entry.accounting.sourceId) === entry : true,
  );
}

export function buildSidebarQuotaPanelLines(params: {
  data: QuotaRenderData;
  config: Pick<QuotaToastConfig, "percentDisplayMode">;
}): string[] {
  const data = sanitizeQuotaRenderData(params.data);
  const rows = groupQuotaEntries(data.entries, "quota")
    .map(({ group, entries }) => ({
      provider: formatSidebarProviderLabel(group),
      entries,
      isBudgetBased: entries.some((entry) =>
        ["budget", "balance", "spend"].includes(entry.accounting.resultType),
      ),
    }))
    .filter(({ provider }) => provider !== "OpenCode Zen")
    .sort(
      (left, right) =>
        Number(left.isBudgetBased) - Number(right.isBudgetBased) ||
        left.provider.localeCompare(right.provider, "en", { sensitivity: "base" }),
    )
    .flatMap(({ provider, entries }) =>
      selectSidebarEntries(entries).map((entry) => {
        const row = interpretAccountingRow(entry, { booleanWording: "semantic" });
        const label = normalizeSingleWindowLabelText(entry.label);
        const windowKind =
          entry.semantic?.metric.kind === "window"
            ? entry.semantic.metric.window
            : entry.semantic
              ? null
              : classifyQuotaWindowText(label);
        const window =
          !entry.semantic && /^\d+(?:\.\d+)?[mhd]$/iu.test(label)
            ? label.toLowerCase()
            : windowKind
              ? SIDEBAR_WINDOW_LABELS[windowKind]
              : "";
        const value =
          row.display.kind === "percent"
            ? formatDisplayedPercentLabel(
                row.display.percentRemaining,
                params.config.percentDisplayMode,
                "bare",
              )
            : row.display.text;
        const reset = formatResetCountdown(entry.resetTimeIso, {
          compactRounded: true,
          decimals: 1,
        });
        return {
          cells: [provider, window, reset === "reset" ? "" : reset, value],
          isPercent: row.display.kind === "percent",
        };
      }),
    );
  const lines: string[] = [];
  for (const row of rows) {
    const widths: number[] = [...SIDEBAR_COLUMN_WIDTHS];
    if (row.isPercent) widths[3] = displayedPercentLabelWidth("bare") + 1;
    const cells = row.cells.map((cell, index) => wrapDisplayText(cell, widths[index]!));
    for (let line = 0; line < Math.max(...cells.map((cell) => cell.length)); line++) {
      const columns = cells.map((cell, index) => {
        const value = cell[line] ?? "";
        return index === 0 ? value.padEnd(widths[index]!) : value.padStart(widths[index]!);
      });
      lines.push(
        `${columns[0]} ${columns
          .slice(1)
          .join(" ")
          .padStart(TUI_SIDEBAR_MAX_WIDTH - SIDEBAR_COLUMN_WIDTHS[0] - 1)}`,
      );
    }
  }
  const errors = data.errors
    .filter((error) => formatSidebarProviderLabel(error.label) !== "OpenCode Zen")
    .sort((left, right) =>
      formatSidebarProviderLabel(left.label).localeCompare(
        formatSidebarProviderLabel(right.label),
        "en",
        { sensitivity: "base" },
      ),
    )
    .flatMap((error) => wrapDisplayText(`${error.label}: ${error.message}`, TUI_SIDEBAR_MAX_WIDTH));
  if (lines.length && errors.length) lines.push("");
  lines.push(...errors);
  return lines;
}
