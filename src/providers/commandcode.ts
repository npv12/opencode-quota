/**
 * Command Code provider wrapper.
 *
 * Queries the Command Code `/alpha/billing/credits` + `/alpha/usage/summary`
 * endpoints and maps the credit pool and rolling window usage into
 * provider-neutral accounting rows.
 */

import {
  type CommandCodeQuotaResult,
  getCommandCodeKeyDiagnostics,
  hasCommandCodeApiKeyConfigured,
  queryCommandCodeQuota,
} from "../lib/commandcode.js";
import type {
  QuotaProvider,
  QuotaProviderContext,
  QuotaProviderResult,
  QuotaToastEntry,
} from "../lib/entries.js";
import { isCanonicalProviderAvailable } from "../lib/provider-availability.js";
import {
  attemptedResult,
  mapNullableProviderResult,
  simpleApiKeyStatusDetails,
  withStatusDetails,
} from "./result-helpers.js";

const COMMANDCODE_GROUP = "Command Code";

const QUOTA_ACCOUNTING = {
  resultType: "quota",
  acquisitionMethod: "remote_api",
  ownership: "maintained",
  authority: "provider_reported",
} as const;

const SPEND_ACCOUNTING = {
  resultType: "spend",
  acquisitionMethod: "remote_api",
  ownership: "maintained",
  authority: "provider_reported",
} as const;

const USAGE_ACCOUNTING = {
  resultType: "usage",
  acquisitionMethod: "remote_api",
  ownership: "maintained",
  authority: "provider_reported",
} as const;

function percentRemaining(used: number | undefined, cap: number | undefined): number | undefined {
  if (used === undefined || cap === undefined || cap <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round((1 - used / cap) * 100)));
}

function buildCommandCodeResult(result: {
  success: true;
  data: CommandCodeQuotaResult;
}): QuotaProviderResult {
  const { credits, usage } = result.data;
  const entries: QuotaToastEntry[] = [];

  if (credits.totalRemaining !== undefined) {
    entries.push({
      kind: "quantity",
      accounting: QUOTA_ACCOUNTING,
      name: "commandcode-remaining-credits",
      group: COMMANDCODE_GROUP,
      semantic: {
        metric: { kind: "component", component: "remaining_credits" },
        prominence: "primary",
      },
      quantity: { decimal: credits.totalRemaining, unit: { kind: "currency", code: "USD" } },
    });
  }

  for (const [key, window, label] of [
    ["fiveHour", credits.fiveHour, "5h:"],
    ["weekly", credits.weekly, "Weekly:"],
  ] as const) {
    const value = window;
    if (!value) continue;
    const used = value.used === undefined ? undefined : Number(value.used);
    const cap = value.cap === undefined ? undefined : Number(value.cap);
    const remaining = percentRemaining(used, cap);
    if (remaining === undefined) continue;
    entries.push({
      accounting: QUOTA_ACCOUNTING,
      name: `commandcode-${key}-remaining`,
      group: COMMANDCODE_GROUP,
      label,
      percentRemaining: remaining,
      resetTimeIso: value.resetAt,
    });
  }

  if (usage.totalCost !== undefined) {
    entries.push({
      kind: "quantity",
      accounting: SPEND_ACCOUNTING,
      name: "commandcode-period-cost",
      group: COMMANDCODE_GROUP,
      semantic: { metric: { kind: "named", name: "Billed" }, prominence: "supplementary" },
      quantity: { decimal: usage.totalCost, unit: { kind: "currency", code: "USD" } },
    });
  }

  if (usage.totalTokens !== undefined) {
    entries.push({
      kind: "quantity",
      accounting: USAGE_ACCOUNTING,
      name: "commandcode-period-tokens",
      group: COMMANDCODE_GROUP,
      semantic: { metric: { kind: "named", name: "Tokens" }, prominence: "supplementary" },
      quantity: { decimal: usage.totalTokens, unit: { kind: "count", unit: "token" } },
    });
  }

  if (usage.totalCount !== undefined) {
    entries.push({
      kind: "quantity",
      accounting: USAGE_ACCOUNTING,
      name: "commandcode-period-requests",
      group: COMMANDCODE_GROUP,
      semantic: { metric: { kind: "named", name: "Requests" }, prominence: "supplementary" },
      quantity: { decimal: usage.totalCount, unit: { kind: "count", unit: "request" } },
    });
  }

  if (result.data.planId !== undefined) {
    entries.push({
      kind: "value",
      accounting: QUOTA_ACCOUNTING,
      name: "commandcode-plan",
      group: COMMANDCODE_GROUP,
      label: "Plan:",
      value: result.data.planId,
    });
  }

  return attemptedResult(entries);
}

export const commandCodeProvider: QuotaProvider = {
  id: "commandcode",

  async isAvailable(ctx: QuotaProviderContext): Promise<boolean> {
    if (
      await isCanonicalProviderAvailable({ ctx, providerId: "commandcode", fallbackOnError: false })
    ) {
      return true;
    }
    return await hasCommandCodeApiKeyConfigured();
  },

  matchesCurrentModel(model: string): boolean {
    return model.toLowerCase().startsWith("commandcode/");
  },

  async fetch(ctx: QuotaProviderContext): Promise<QuotaProviderResult> {
    const diagnostics = await getCommandCodeKeyDiagnostics().catch(() => ({
      configured: false,
      source: null,
      checkedPaths: [],
      credentialDatabasePaths: [],
    }));
    const result = await queryCommandCodeQuota({
      requestTimeoutMs: ctx.config?.requestTimeoutMs,
    });
    const providerResult = mapNullableProviderResult(result, {
      errorLabel: "Command Code",
      onSuccess: buildCommandCodeResult,
    });
    return withStatusDetails(providerResult, simpleApiKeyStatusDetails(diagnostics));
  },
};
