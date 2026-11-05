import { describe, expect, it } from "vitest";
import type { ProviderSnapshot, QuotaRow, QuotaSnapshot } from "../src/core/types.js";
import { defaultSettings } from "../src/settings/schema.js";
import { minimalSidebarLines } from "../src/view/minimal-sidebar.js";
import { lineText } from "../src/view/text.js";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");

function row(id: string, fields: Partial<QuotaRow> = {}): QuotaRow {
  const [providerId = "", _key = ""] = id.split(".");
  return {
    id,
    providerId,
    label: "7d",
    type: "quota",
    method: "remote_api",
    authority: "provider_reported",
    window: "week",
    prominence: "primary",
    percentRemaining: 80,
    ...fields,
  };
}

function provider(
  providerId: string,
  label: string,
  rows: QuotaRow[],
  error?: ProviderSnapshot["error"],
): ProviderSnapshot {
  return {
    providerId,
    label,
    rows,
    checkedAtMs: NOW,
    refreshing: false,
    debug: [],
    ...(error ? { error } : {}),
  };
}

function snapshot(providers: ProviderSnapshot[]): QuotaSnapshot {
  return {
    version: 6,
    providers,
    resetNotices: [],
    generatedAtMs: NOW,
    serverId: "server",
    revision: 1,
  };
}

const lines = (current: QuotaSnapshot) =>
  minimalSidebarLines({ snapshot: current, settings: defaultSettings(), nowMs: NOW }).map(lineText);

describe("minimal sidebar", () => {
  it("writes one colored row per provider with a bare percent", () => {
    const claude = provider("anthropic", "Claude", [
      row("anthropic.weekly", {
        percentRemaining: 12,
        resetsAt: new Date(NOW + 3.2 * 86_400_000).toISOString(),
      }),
    ]);
    const lines = minimalSidebarLines({
      snapshot: snapshot([claude]),
      settings: defaultSettings(),
      nowMs: NOW,
    });
    expect(lines.map(lineText)).toEqual(["  Claude               7d  3.2d  12%"]);
    expect(lines[0]?.segments.map((segment) => segment.role)).toEqual([
      "label",
      "provider",
      "label",
      "value",
      "label",
      "reset",
      "label",
      "percent",
    ]);
    expect(lines[0]?.segments.at(-1)?.percent).toBe(12);
  });

  it("keeps the limiting window of each provider and sorts budget rows last", () => {
    const claude = provider("anthropic", "Claude", [
      row("anthropic.five_hour", { label: "5h", window: "five_hour", percentRemaining: 58 }),
      row("anthropic.weekly", { percentRemaining: 12 }),
    ]);
    const openrouter = provider("openrouter", "OpenRouter", [
      row("openrouter.balance", {
        label: "Balance",
        type: "balance",
        window: undefined,
        percentRemaining: undefined,
        text: "$5.00 left",
      }),
    ]);
    expect(lines(snapshot([openrouter, claude]))).toEqual([
      "  Claude              7d         12%",
      "  OpenRouter              $5.00 left",
    ]);
  });

  it("hides OpenCode Zen and keeps each account apart", () => {
    const zen = provider("opencode-zen", "OpenCode Zen", [row("opencode-zen.budget")]);
    const copilot = provider("github-copilot", "Copilot", [
      row("github-copilot.work", { account: "work", percentRemaining: 40 }),
      row("github-copilot.personal", { account: "personal", percentRemaining: 60 }),
    ]);
    expect(lines(snapshot([zen, copilot]))).toEqual([
      "  Copilot                    7d  60%",
      "  Copilot                    7d  40%",
    ]);
  });

  it("shows a weekly label as 7d and leaves a budget row's window blank", () => {
    const anthropic = provider("anthropic", "Anthropic", [
      row("anthropic.weekly", { label: "Weekly", window: undefined, percentRemaining: 92 }),
    ]);
    const openrouter = provider("openrouter", "OpenRouter (Plus)", [
      row("openrouter.budget", {
        label: "Budget",
        type: "budget",
        window: undefined,
        percentRemaining: 7,
      }),
    ]);
    expect(lines(snapshot([openrouter, anthropic]))).toEqual([
      "  Anthropic                  7d  92%",
      "  OpenRouter                      7%",
    ]);
  });

  it("hides OpenCode Zen's own provider id", () => {
    const zen = provider("opencode", "OpenCode Zen", [
      row("opencode.budget", { label: "Budget", type: "budget", percentRemaining: undefined }),
    ]);
    expect(lines(snapshot([zen]))).toEqual([]);
  });

  it("wraps a provider error under the rows it kept", () => {
    const claude = provider("anthropic", "Claude", [], {
      code: "timeout",
      message: "The provider did not answer before the request timed out.",
    });
    expect(lines(snapshot([claude]))).toEqual(["  Claude: Timed out"]);
  });
});
