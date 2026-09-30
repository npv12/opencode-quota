import type { SessionTokensData } from "./entries.js";
import {
  getSessionTokenSummary,
  getSessionTreeTokenSummary,
  SessionNotFoundError,
} from "./quota-stats.js";
import type { SessionTokenScope } from "./types.js";

export interface SessionTokenError {
  sessionID: string;
  error: string;
  checkedPath?: string;
}

export interface SessionTokenFetchResult {
  sessionTokens?: SessionTokensData;
  error?: SessionTokenError;
}

/**
 * Fetch session token summary for display.
 *
 * @returns `sessionTokens` on success (undefined if no data),
 *          `error` on failure (for diagnostics).
 *          When both are undefined the feature was disabled or sessionID missing.
 */
export async function fetchSessionTokensForDisplay(params: {
  enabled: boolean;
  sessionID?: string;
  scope: SessionTokenScope;
}): Promise<SessionTokenFetchResult> {
  if (!params.enabled || !params.sessionID) return {};

  try {
    const summary =
      params.scope === "tree"
        ? await getSessionTreeTokenSummary(params.sessionID)
        : await getSessionTokenSummary(params.sessionID);
    if (summary && summary.models.length > 0) {
      return {
        sessionTokens: {
          models: summary.models,
          totalInput: summary.totalInput,
          totalCachedInput: summary.totalCachedInput,
          totalCombinedInput: summary.totalCombinedInput,
          totalOutput: summary.totalOutput,
        },
      };
    }
    return {};
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return {
        error: {
          sessionID: err.sessionID,
          error: err.message,
          checkedPath: err.checkedPath,
        },
      };
    }
    return {
      error: {
        sessionID: params.sessionID,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
