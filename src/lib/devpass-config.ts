import { getCredentialDatabasePaths, readAuthFile } from "./opencode-auth.js";
import type { AuthData } from "./types.js";

export interface DevPassApiKeyResult {
  key: string;
  source: DevPassKeySource;
}

/**
 * DevPass (LLM Gateway) credentials are stored exclusively in the OpenCode
 * credential database under the `llmgateway` integration id.
 */
export type DevPassKeySource = "opencode.db";

const DEVPASS_AUTH_KEYS = ["llmgateway", "devpass"] as const;

function extractDevPassApiKey(auth: AuthData | null): string | null {
  if (!auth) return null;

  for (const authKey of DEVPASS_AUTH_KEYS) {
    const entry = auth[authKey as keyof AuthData];
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const type = record.type;
    const apiType = type === "api" || type === "key" ? "api" : undefined;
    if (apiType && typeof record.key === "string" && record.key.trim().length > 0) {
      return record.key.trim();
    }
  }

  return null;
}

export async function resolveDevPassApiKey(): Promise<DevPassApiKeyResult | null> {
  const auth = await readAuthFile();
  const key = extractDevPassApiKey(auth);
  return key ? { key, source: "opencode.db" } : null;
}

export async function hasDevPassApiKey(): Promise<boolean> {
  return (await resolveDevPassApiKey()) !== null;
}

export async function getDevPassKeyDiagnostics(): Promise<{
  configured: boolean;
  source: DevPassKeySource | null;
  checkedPaths: string[];
  credentialDatabasePaths: string[];
}> {
  const resolved = await resolveDevPassApiKey();
  return {
    configured: resolved !== null,
    source: resolved?.source ?? null,
    checkedPaths: [],
    credentialDatabasePaths: getCredentialDatabasePaths(),
  };
}
