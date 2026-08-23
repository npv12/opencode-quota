import { sanitizeQuotaRenderData } from "./display-sanitize.js";
import type { QuotaRenderData } from "./quota-render-data.js";
import type { QuotaToastConfig } from "./types.js";
import type { QuotaToastEntry, AccountingWindow } from "./entries.js";
import { isPercentEntry, isValueEntry, isQuantityEntry } from "./entries.js";
import { formatResetCountdown } from "./format-utils.js";
import { classifyQuotaWindowText } from "./quota-entry-display.js";

export const TUI_SIDEBAR_MAX_WIDTH = 36;
export const TUI_SIDEBAR_LAYOUT = {
  maxWidth: TUI_SIDEBAR_MAX_WIDTH,
  narrowAt: TUI_SIDEBAR_MAX_WIDTH,
  tinyAt: 20,
} as const;

function formatWindowLabel(window: AccountingWindow | undefined): string {
  if (!window) return "";
  const labels: Record<AccountingWindow, string> = {
    rpm: "rpm",
    hour: "1h",
    five_hour: "5h",
    day: "1d",
    week: "7d",
    month: "30d",
    year: "1y",
    mcp: "mcp",
    code_review: "review",
  };
  return labels[window] || "";
}

function formatEntryValue(entry: QuotaToastEntry): string {
  if (isPercentEntry(entry)) {
    const pct = Math.max(0, Math.round(entry.percentRemaining));
    return `${pct}%`;
  }
  if (isValueEntry(entry)) {
    return entry.value;
  }
  if (isQuantityEntry(entry)) {
    const unit = entry.quantity.unit;
    if (unit.kind === "currency") {
      return `${unit.code}${entry.quantity.decimal}`;
    }
    if (unit.kind === "count") {
      return `${entry.quantity.decimal}`;
    }
    return `${entry.quantity.decimal}${unit.symbol}`;
  }
  return "";
}

function getWindowFromEntry(entry: QuotaToastEntry): AccountingWindow | undefined {
  if (entry.semantic?.metric.kind === "window") {
    return entry.semantic.metric.window;
  }
  // Fallback: classify from label or name text
  const kind = classifyQuotaWindowText(entry.label ?? "") ?? classifyQuotaWindowText(entry.name);
  if (kind) {
    const map: Record<string, AccountingWindow> = {
      rpm: "rpm",
      five_hour: "five_hour",
      hour: "hour",
      week: "week",
      day: "day",
      month: "month",
      year: "year",
      mcp: "mcp",
      code_review: "code_review",
    };
    return map[kind];
  }
  return undefined;
}

interface ProviderWindow {
  provider: string;
  window: AccountingWindow | undefined;
  resetTimeIso?: string;
  percentRemaining: number;
  value: string;
}

function extractProviderWindows(entries: QuotaToastEntry[]): ProviderWindow[] {
  const windows: ProviderWindow[] = [];

  for (const entry of entries) {
    const window = getWindowFromEntry(entry);
    const windowLabel = formatWindowLabel(window);
    
    // Extract base provider name - remove common window suffixes
    let provider = entry.name;
    const suffixes = [" 5h", " 1d", " 7d", " 30d", " Daily", " Weekly", " Monthly", " Hourly"];
    for (const suffix of suffixes) {
      if (provider.endsWith(suffix)) {
        provider = provider.slice(0, -suffix.length);
        break;
      }
    }

    // Remove brackets and plan suffixes like (Plus)
    provider = provider.replace(/^\[([^\]]+)\]/u, "$1").replace(/\s*\([^)]+\)/u, "").trim();

    const percentRemaining = isPercentEntry(entry) ? entry.percentRemaining : 100;
    const value = formatEntryValue(entry);

    windows.push({
      provider,
      window,
      resetTimeIso: entry.resetTimeIso,
      percentRemaining,
      value,
    });
  }

  return windows;
}

function selectLowestWindows(windows: ProviderWindow[]): ProviderWindow[] {
  // Group by provider
  const byProvider = new Map<string, ProviderWindow[]>();
  for (const w of windows) {
    const existing = byProvider.get(w.provider) || [];
    existing.push(w);
    byProvider.set(w.provider, existing);
  }

  // For each provider, select the window with lowest percent
  const result: ProviderWindow[] = [];
  for (const [, providerWindows] of byProvider) {
    const lowest = providerWindows.reduce((min, w) => 
      w.percentRemaining < min.percentRemaining ? w : min
    );
    result.push(lowest);
  }

  return result;
}

export function buildSidebarQuotaPanelLines(params: {
  data: QuotaRenderData;
  config: Pick<QuotaToastConfig, "formatStyle" | "percentDisplayMode" | "resetTimeDecimals"> &
    Partial<Pick<QuotaToastConfig, "accountingDetail">>;
}): string[] {
  const data = sanitizeQuotaRenderData(params.data);
  if (!data || data.entries.length === 0) return [];

  // Extract all provider windows
  const allWindows = extractProviderWindows(data.entries);
  
  // Select only the lowest percent window per provider
  const selected = selectLowestWindows(allWindows);

  const countdownOpts = {
    compactRounded: true,
    decimals: params.config.resetTimeDecimals ?? 1,
  };

  // Calculate max width for each column in the right block
  const windowWidth = Math.max(...selected.map(w => formatWindowLabel(w.window).length), 1);
  const resetWidth = Math.max(...selected.map(w => {
    if (!w.resetTimeIso) return 0;
    return formatResetCountdown(w.resetTimeIso, countdownOpts).length;
  }), 1);
  const valueWidth = Math.max(...selected.map(w => w.value.length), 1);
  const maxRightWidth = windowWidth + 1 + resetWidth + 1 + valueWidth;

  // Format each line: Provider (left) | Window Reset Value (right-aligned, columns aligned)
  const lines: string[] = [];
  for (const w of selected) {
    const window = formatWindowLabel(w.window).padStart(windowWidth);
    const reset = w.resetTimeIso 
      ? formatResetCountdown(w.resetTimeIso, countdownOpts).padStart(resetWidth)
      : "".padStart(resetWidth);
    const value = w.value.padStart(valueWidth);

    // Provider takes remaining space, left-aligned
    const providerPad = Math.max(1, TUI_SIDEBAR_MAX_WIDTH - maxRightWidth - 1);
    const provider = w.provider.padEnd(providerPad);

    lines.push(`${provider} ${window} ${reset} ${value}`);
  }

  return lines;
}
