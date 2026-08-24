/**
 * Command Code billing/usage fetcher.
 *
 * Queries the same undocumented `/alpha/*` endpoints the official CLI's
 * `/usage` view uses, authenticated with the Command Code API key:
 *
 *   GET /alpha/whoami                -> account identity (auth gate)
 *   GET /alpha/billing/subscriptions -> current billing period
 *   GET /alpha/billing/credits       -> monthly/purchased/free credit pool
 *                                        + 5-hour/weekly window usage
 *   GET /alpha/usage/summary         -> spend / tokens / run count
 *
 * These endpoints are not part of the documented Provider API and may change.
 * They need the CLI session key (opencode `/connect` "Command Code API key"),
 * not necessarily a provider-only API key.
 */

import { isCanonicalAccountingDecimal } from "./accounting-format.js";
import { resolveCommandCodeApiKey } from "./commandcode-auth.js";
import { sanitizeDisplaySnippet, sanitizeDisplayText } from "./display-sanitize.js";
import { fetchWithTimeout } from "./http.js";
import type { QuotaError } from "./types.js";

const DEFAULT_API_BASE = "https://api.commandcode.ai";
const USER_AGENT = "OpenCode-Quota-Toast/1.0";
const MAX_PARSE_ISSUES = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function toDecimal(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const decimal = String(value);
  return isCanonicalAccountingDecimal(decimal) ? decimal : undefined;
}

/** Fetch a JSON GET endpoint with the given key, returning the decoded body or a QuotaError. */
async function fetchJson(
  url: string,
  apiKey: string,
  options: { requestTimeoutMs?: number },
): Promise<unknown | QuotaError> {
  try {
    return await fetchWithTimeout<unknown | QuotaError>(url, {
      request: {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": USER_AGENT,
        },
      },
      timeoutMs: options.requestTimeoutMs,
      consume: async (response) => {
        const text = await response.text();
        if (!response.ok) {
          return {
            success: false as const,
            error: `Command Code API error ${response.status}: ${sanitizeDisplaySnippet(text, 120)}`,
            retryable: response.status === 429 || response.status >= 500,
          };
        }
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return {
            success: false as const,
            error: "Command Code API returned invalid JSON",
          };
        }
      },
    });
  } catch (err) {
    return {
      success: false as const,
      error: sanitizeDisplayText(err instanceof Error ? err.message : String(err)),
      retryable: true,
    };
  }
}

export interface CommandCodeWindowUsage {
  used?: string;
  cap?: string;
  resetAt?: string;
}

export interface CommandCodeCredits {
  monthlyCredits?: string;
  purchasedCredits?: string;
  freeCredits?: string;
  totalRemaining?: string;
  fiveHour?: CommandCodeWindowUsage;
  weekly?: CommandCodeWindowUsage;
}

export interface CommandCodeUsageSummary {
  totalCount?: string;
  totalCost?: string;
  totalTokens?: string;
  totalTokensIn?: string;
  totalTokensOut?: string;
  successRate?: string;
}

export interface CommandCodeIdentity {
  userId?: string;
  userName?: string;
  planId?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
}

export interface CommandCodeQuotaResult {
  userId?: string;
  userName?: string;
  planId?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  credits: CommandCodeCredits;
  usage: CommandCodeUsageSummary;
  parseIssues: string[];
}

export type CommandCodeResult = { success: true; data: CommandCodeQuotaResult } | QuotaError | null;

function apiBase(): string {
  return process.env.COMMANDCODE_API_BASE?.trim() || DEFAULT_API_BASE;
}

function apiUrl(path: string): string {
  const base = apiBase().replace(/\/+$/, "");
  return `${base}${path}`;
}

function numberField(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = toDecimal(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function parseWindow(raw: unknown): CommandCodeWindowUsage | undefined {
  if (!isRecord(raw)) return undefined;
  const used = toDecimal(raw.used);
  const cap = toDecimal(raw.cap);
  const resetAt =
    typeof raw.resetAt === "number"
      ? new Date(raw.resetAt).toISOString()
      : getNonEmptyString(raw.resetAt);
  if (used === undefined && cap === undefined && resetAt === undefined) return undefined;
  const window: CommandCodeWindowUsage = {};
  if (used !== undefined) window.used = used;
  if (cap !== undefined) window.cap = cap;
  if (resetAt !== undefined) window.resetAt = resetAt;
  return window;
}

/**
 * Fetch Command Code credits + usage summary in one pass.
 *
 * @returns typed result, or null when no API key is configured.
 */
export async function queryCommandCodeQuota(
  options: { requestTimeoutMs?: number } = {},
): Promise<CommandCodeResult> {
  const resolved = await resolveCommandCodeApiKey();
  if (!resolved) return null;

  const parseIssues: string[] = [];

  const whoamiRaw = await fetchJson(apiUrl("/alpha/whoami"), resolved.key, options);
  if (
    whoamiRaw === null ||
    whoamiRaw === undefined ||
    (whoamiRaw as { success?: boolean }).success === false
  ) {
    const message =
      whoamiRaw && isRecord(whoamiRaw) && typeof whoamiRaw.error === "string"
        ? whoamiRaw.error
        : "Command Code whoami failed";
    return { success: false, error: sanitizeDisplayText(message) };
  }
  const whoami = isRecord(whoamiRaw) ? whoamiRaw : {};
  const user = isRecord(whoami.user) ? whoami.user : {};
  const org = isRecord(whoami.org) ? whoami.org : {};

  const subscriptionsRaw = await fetchJson(
    apiUrl("/alpha/billing/subscriptions"),
    resolved.key,
    options,
  );
  let planId: string | undefined;
  let currentPeriodStart: string | undefined;
  let currentPeriodEnd: string | undefined;
  if (subscriptionsRaw && isRecord(subscriptionsRaw) && isRecord(subscriptionsRaw.data)) {
    const data = subscriptionsRaw.data as Record<string, unknown>;
    planId = getNonEmptyString(data.planId) ?? getNonEmptyString(data.plan);
    currentPeriodStart = getNonEmptyString(data.currentPeriodStart);
    currentPeriodEnd = getNonEmptyString(data.currentPeriodEnd);
  }

  const creditsRaw = await fetchJson(apiUrl("/alpha/billing/credits"), resolved.key, options);
  const credits: CommandCodeCredits = {};
  if (creditsRaw && isRecord(creditsRaw)) {
    const creditsBody = isRecord(creditsRaw.credits)
      ? (creditsRaw.credits as Record<string, unknown>)
      : {};
    credits.monthlyCredits = numberField(creditsBody, ["monthlyCredits", "monthly_credits"]);
    credits.purchasedCredits = numberField(creditsBody, ["purchasedCredits", "purchased_credits"]);
    credits.freeCredits = numberField(creditsBody, ["freeCredits", "free_credits"]);
    const monthly = credits.monthlyCredits;
    const purchased = credits.purchasedCredits;
    const free = credits.freeCredits;
    if (monthly !== undefined || purchased !== undefined || free !== undefined) {
      const total =
        (monthly !== undefined ? Number(monthly) : 0) +
        (purchased !== undefined ? Number(purchased) : 0) +
        (free !== undefined ? Number(free) : 0);
      credits.totalRemaining = String(total);
    }
    if (isRecord(creditsRaw.windowLimits)) {
      const windows = creditsRaw.windowLimits as Record<string, unknown>;
      credits.fiveHour = parseWindow(windows.fiveHour);
      credits.weekly = parseWindow(windows.weekly);
    }
  }

  const summaryRaw = await fetchJson(apiUrl("/alpha/usage/summary"), resolved.key, options);
  const usage: CommandCodeUsageSummary = {};
  if (summaryRaw && isRecord(summaryRaw)) {
    const summary = summaryRaw as Record<string, unknown>;
    usage.totalCount = numberField(summary, ["totalCount", "total_count"]);
    usage.totalCost = numberField(summary, ["totalCost", "total_cost"]);
    usage.totalTokens = numberField(summary, ["totalTokens", "total_tokens"]);
    usage.totalTokensIn = numberField(summary, ["totalTokensIn", "total_tokens_in"]);
    usage.totalTokensOut = numberField(summary, ["totalTokensOut", "total_tokens_out"]);
    usage.successRate = numberField(summary, ["successRate", "success_rate"]);
  }

  if (parseIssues.length > MAX_PARSE_ISSUES) {
    parseIssues.length = MAX_PARSE_ISSUES;
  }

  return {
    success: true,
    data: {
      userId: getNonEmptyString(user.id) ?? getNonEmptyString(user.userId),
      userName: getNonEmptyString(user.userName) ?? getNonEmptyString(user.name),
      planId,
      currentPeriodStart,
      currentPeriodEnd,
      credits,
      usage,
      parseIssues,
    },
  };
}

export {
  type CommandCodeKeySource,
  getCommandCodeKeyDiagnostics,
  hasCommandCodeApiKey as hasCommandCodeApiKeyConfigured,
} from "./commandcode-auth.js";
