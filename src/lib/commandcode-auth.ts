/**
 * Command Code API key resolver.
 *
 * Priority (first wins):
 * 1. COMMANDCODE_API_KEY environment variable
 * 2. Trusted user/global opencode.json/opencode.jsonc (`provider.commandcode.options.apiKey`)
 * 3. opencode.db credential database (the `/connect` "Command Code API key" key method)
 *
 * The Command Code billing/usage endpoints (`/alpha/billing/credits`,
 * `/alpha/usage/summary`, ...) use the same API key as inference, so the
 * resolver mirrors the inference auth chain.
 */

import {
  createProviderApiKeyResolver,
  getGlobalOpencodeConfigCandidatePaths,
} from "./api-key-resolver.js";
import { getCredentialDatabasePaths, readAuthFile } from "./opencode-auth.js";

export interface CommandCodeApiKeyResult {
  key: string;
  source: CommandCodeKeySource;
}

const ALLOWED_COMMANDCODE_ENV_VARS = ["COMMANDCODE_API_KEY"] as const;
const COMMANDCODE_PROVIDER_KEYS = ["commandcode"] as const;

export type CommandCodeKeySource =
  | "env:COMMANDCODE_API_KEY"
  | "opencode.json"
  | "opencode.jsonc"
  | "opencode.db";

export { getGlobalOpencodeConfigCandidatePaths as getOpencodeConfigCandidatePaths } from "./api-key-resolver.js";

const commandCodeApiKeyResolver = createProviderApiKeyResolver<CommandCodeKeySource>({
  envVars: [{ name: "COMMANDCODE_API_KEY", source: "env:COMMANDCODE_API_KEY" }],
  providerKeys: COMMANDCODE_PROVIDER_KEYS,
  allowedEnvVars: ALLOWED_COMMANDCODE_ENV_VARS,
  configJsonSource: "opencode.json",
  configJsoncSource: "opencode.jsonc",
  getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
  auth: {
    readAuth: readAuthFile,
    getCredentialDatabasePaths,
    authSource: "opencode.db",
  },
});

export async function resolveCommandCodeApiKey(): Promise<CommandCodeApiKeyResult | null> {
  return commandCodeApiKeyResolver.resolve();
}

export async function hasCommandCodeApiKey(): Promise<boolean> {
  return commandCodeApiKeyResolver.has();
}

export async function getCommandCodeKeyDiagnostics(): Promise<{
  configured: boolean;
  source: CommandCodeKeySource | null;
  checkedPaths: string[];
  credentialDatabasePaths: string[];
}> {
  return commandCodeApiKeyResolver.diagnostics();
}
