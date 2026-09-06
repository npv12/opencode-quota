/**
 * LLM Gateway DevPass provider wrapper.
 *
 * Queries the LLM Gateway key status endpoint and reports DevPass monthly plan
 * credits plus the weekly premium-model allowance.
 */

import type {
  QuotaProvider,
  QuotaProviderContext,
  QuotaProviderResult,
  QuotaToastEntry,
} from "../lib/entries.js";
import { getDevPassKeyDiagnostics, hasDevPassApiKey } from "../lib/devpass-config.js";
import type { DevPassAllowanceWindow, DevPassKeyStatus, DevPassResult } from "../lib/devpass.js";
import { queryDevPassUsage } from "../lib/devpass.js";
import { isCanonicalProviderAvailable } from "../lib/provider-availability.js";
import { modelProviderMatchesRuntimeId } from "../lib/provider-model-matching.js";
import {
  attemptedResult,
  mapNullableProviderResult,
  simpleApiKeyStatusDetails,
  withStatusDetails,
} from "./result-helpers.js";

const DEVPASS_GROUP = "DevPass";
const REMOTE_API_ACCOUNTING = {
  acquisitionMethod: "remote_api",
  ownership: "maintained",
  authority: "provider_reported",
} as const;

function allowanceEntry(
  suffix: string,
  label: string,
  window: DevPassAllowanceWindow,
): QuotaToastEntry {
  return {
    accounting: {
      resultType: "quota",
      ...REMOTE_API_ACCOUNTING,
    },
    name: `${DEVPASS_GROUP} ${suffix}`,
    group: DEVPASS_GROUP,
    label,
    percentRemaining: window.percentRemaining,
    ...(window.resetTimeIso ? { resetTimeIso: window.resetTimeIso } : {}),
  };
}

function mapDevPassSuccess(result: Extract<DevPassResult, { success: true }>): QuotaProviderResult {
  const status = result.status;
  const entries: QuotaToastEntry[] = [];

  if (status.monthly) {
    entries.push(allowanceEntry("Monthly", "Monthly:", status.monthly));
  }
  if (status.weeklyPremium) {
    entries.push(allowanceEntry("Premium Weekly", "Premium weekly:", status.weeklyPremium));
  }

  const errors =
    entries.length === 0
      ? [{ label: DEVPASS_GROUP, message: `No DevPass plan on this LLM Gateway key (${status.devPlan})` }]
      : [];

  return withStatusDetails(attemptedResult(entries, errors), [
    ...statusDetailsFromStatus(status),
  ]);
}

function statusDetailsFromStatus(status: DevPassKeyStatus) {
  const details: Array<{ key: string; value: string }> = [
    { key: "dev_plan", value: status.devPlan },
  ];
  if (status.monthly) {
    details.push({
      key: "monthly",
      value: `used=${status.monthly.used}/${status.monthly.limit} percent_remaining=${status.monthly.percentRemaining}`,
    });
  }
  if (status.weeklyPremium) {
    details.push({
      key: "premium_weekly",
      value: `used=${status.weeklyPremium.used}/${status.weeklyPremium.limit} percent_remaining=${status.weeklyPremium.percentRemaining} reset_at=${status.weeklyPremium.resetTimeIso ?? "(none)"}`,
    });
  }
  if (status.keyLimit) {
    details.push({
      key: "key_limit",
      value: `used=${status.keyLimit.used}/${status.keyLimit.limit} percent_remaining=${status.keyLimit.percentRemaining}`,
    });
  } else if (status.keyUsage !== undefined) {
    details.push({ key: "key_usage", value: status.keyUsage.toString() });
  }
  return details;
}

export const devpassProvider: QuotaProvider = {
  id: "devpass",

  async isAvailable(ctx: QuotaProviderContext): Promise<boolean> {
    const providerAvailable = await isCanonicalProviderAvailable({
      ctx,
      providerId: "devpass",
      fallbackOnError: false,
    });
    if (providerAvailable) return true;

    return await hasDevPassApiKey();
  },

  matchesCurrentModel(model: string): boolean {
    return modelProviderMatchesRuntimeId(model, "devpass");
  },

  async fetch(ctx: QuotaProviderContext): Promise<QuotaProviderResult> {
    const diagnostics = await getDevPassKeyDiagnostics().catch(() => ({
      configured: false,
      source: null,
      checkedPaths: [],
      credentialDatabasePaths: [],
    }));
    const result = await queryDevPassUsage({ requestTimeoutMs: ctx.config?.requestTimeoutMs });
    const providerResult = mapNullableProviderResult(result, {
      errorLabel: "DevPass",
      onSuccess: mapDevPassSuccess,
    });

    return withStatusDetails(providerResult, [
      ...simpleApiKeyStatusDetails(diagnostics),
      ...(providerResult.statusDetails ?? []),
    ]);
  },
};
