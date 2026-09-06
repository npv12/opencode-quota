/**
 * LLM Gateway DevPass usage fetcher.
 *
 * Queries: GET https://api.llmgateway.io/v1/key
 * Auth: Bearer gateway API key in Authorization header.
 */

import { sanitizeDisplaySnippet, sanitizeDisplayText } from "./display-sanitize.js";
import { resolveDevPassApiKey } from "./devpass-config.js";
import { fetchWithTimeout } from "./http.js";
import type { QuotaError } from "./types.js";

export type DevPassPlanName = "lite" | "pro" | "max" | "none";

export interface DevPassAllowanceWindow {
  used: number;
  limit: number;
  percentRemaining: number;
  resetTimeIso?: string;
}

export interface DevPassKeyStatus {
  devPlan: DevPassPlanName;
  monthly?: DevPassAllowanceWindow;
  weeklyPremium?: DevPassAllowanceWindow;
  keyLimit?: DevPassAllowanceWindow;
  keyUsage?: number;
}

export type DevPassResult =
  | {
      success: true;
      status: DevPassKeyStatus;
    }
  | QuotaError
  | null;

const DEVPASS_KEY_URL = "https://api.llmgateway.io/v1/key";
const USER_AGENT = "OpenCode-Quota-Toast/1.0";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function buildAllowanceWindow(
  used: number,
  limit: number,
  resetTimeIso?: string,
): DevPassAllowanceWindow {
  return {
    used,
    limit,
    percentRemaining: ((limit - used) / limit) * 100,
    ...(resetTimeIso ? { resetTimeIso } : {}),
  };
}

function parseDevPassKeyStatus(payload: unknown): DevPassKeyStatus {
  const data = isRecord(payload) ? payload.data : undefined;
  if (!isRecord(data)) {
    throw new Error("LLM Gateway key response returned an unexpected response shape");
  }

  const rawPlan = getNonEmptyString(data.devPlan);
  const devPlan =
    rawPlan === "lite" || rawPlan === "pro" || rawPlan === "max" || rawPlan === "none"
      ? rawPlan
      : "none";

  const status: DevPassKeyStatus = { devPlan };

  const monthlyLimit = parseNonNegativeNumber(data.devPlanCreditsLimit);
  const monthlyUsed = parseNonNegativeNumber(data.devPlanCreditsUsed);
  if (devPlan !== "none" && monthlyLimit !== undefined && monthlyUsed !== undefined && monthlyLimit > 0) {
    status.monthly = buildAllowanceWindow(monthlyUsed, monthlyLimit);
  }

  const weeklyLimit = parseNonNegativeNumber(data.devPlanPremiumWeeklyLimit);
  const weeklyUsed = parseNonNegativeNumber(data.devPlanPremiumCreditsUsed);
  if (weeklyLimit !== undefined && weeklyUsed !== undefined && weeklyLimit > 0) {
    status.weeklyPremium = buildAllowanceWindow(
      weeklyUsed,
      weeklyLimit,
      getNonEmptyString(data.devPlanPremiumWeekResetsAt),
    );
  }

  const keyLimit = parseNonNegativeNumber(data.limit);
  const keyUsage = parseNonNegativeNumber(data.usage);
  if (keyUsage !== undefined) status.keyUsage = keyUsage;
  if (keyLimit !== undefined && keyUsage !== undefined && keyLimit > 0) {
    status.keyLimit = buildAllowanceWindow(keyUsage, keyLimit);
  }

  return status;
}

async function fetchDevPassKeyStatus(
  apiKey: string,
  requestTimeoutMs?: number,
): Promise<{ success: true; status: DevPassKeyStatus } | { success: false; message: string }> {
  try {
    return await fetchWithTimeout(DEVPASS_KEY_URL, {
      request: {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": USER_AGENT,
        },
      },
      timeoutMs: requestTimeoutMs,
      consume: async (response) => {
        if (!response.ok) {
          const text = await response.text();
          return {
            success: false as const,
            message: `LLM Gateway API error ${response.status}: ${sanitizeDisplaySnippet(text, 120)}`,
          };
        }

        return {
          success: true as const,
          status: parseDevPassKeyStatus(await response.json()),
        };
      },
    });
  } catch (err) {
    return {
      success: false,
      message: sanitizeDisplayText(err instanceof Error ? err.message : String(err)),
    };
  }
}

/**
 * Query the DevPass usage meters for the configured LLM Gateway API key.
 *
 * @returns A typed result with success/error state, or null if no API key is configured.
 */
export async function queryDevPassUsage(
  options: { requestTimeoutMs?: number } = {},
): Promise<DevPassResult> {
  const resolved = await resolveDevPassApiKey();
  if (!resolved) return null;

  const result = await fetchDevPassKeyStatus(resolved.key, options.requestTimeoutMs);

  if (!result.success) {
    return { success: false, error: result.message };
  }

  return { success: true, status: result.status };
}
