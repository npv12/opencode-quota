/**
 * The quota lines of `opencode-quota show` and the fresh provider check behind them.
 */
import { loadProviderSource, type ProviderSourceHost } from "../core/provider-source.js";
import { createQuotaStore } from "../core/store.js";
import type { ProviderSnapshot, QuotaSnapshot } from "../core/types.js";
import { DEFAULT_WORDS } from "../view/format.js";
import { type RowSettings, type SurfaceRows, visibleGroups } from "../view/select.js";
import { plainLines } from "../view/text.js";
import { sanitizeDisplayText } from "./display-sanitize.js";

/** `opencode-quota show` lists every row of every provider. */
const EVERY_ROW: SurfaceRows = { hidden: [], providerOrder: [], rowOrder: {} };
const EVERY_ROW_SETTINGS: RowSettings = {
  sidebar: EVERY_ROW,
  collapsed: EVERY_ROW,
  statusLine: EVERY_ROW,
  toast: EVERY_ROW,
};

/**
 * The quota lines `opencode-quota show` prints, in the snapshot's words: a line per row (with
 * "runs out in ..." when the quota runs out before its reset), a line per provider problem, then
 * the session's tokens when the snapshot has them.
 */
export function quotaReportLines(snapshot: QuotaSnapshot, nowMs: number): string[] {
  const words = snapshot.words ?? DEFAULT_WORDS;
  const groups = visibleGroups(snapshot, EVERY_ROW_SETTINGS, "toast", words);
  const sessionTokens = snapshot.sessionTokens ? { sessionTokens: snapshot.sessionTokens } : {};
  return plainLines({ groups, words, nowMs, runsOut: true, ...sessionTokens }).map(
    sanitizeDisplayText,
  );
}

/**
 * A fresh check of every enabled and available provider (or only `providerId`), through a
 * store of its own that keeps nothing: the same providers, rows, errors and debug details the
 * plugin's store would hold.
 */
export async function checkProviders(
  host: ProviderSourceHost,
  providerId?: string,
): Promise<QuotaSnapshot> {
  const store = createQuotaStore({ source: () => loadProviderSource(host), file: null });
  try {
    const providerIds = providerId ? [providerId] : undefined;
    const snapshot = await store.refresh({ reason: "manual", providerIds });
    const providers = snapshot.providers.filter(
      (provider: ProviderSnapshot) => !providerId || provider.providerId === providerId,
    );
    return { ...snapshot, providers };
  } finally {
    await store.dispose();
  }
}
