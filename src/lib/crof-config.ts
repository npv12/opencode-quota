import {
  createProviderApiKeyResolver,
  getGlobalOpencodeConfigCandidatePaths,
} from "./api-key-resolver.js";
import { getAuthPaths, readAuthFile } from "./opencode-auth.js";

export interface CrofApiKeyResult {
  key: string;
  source: CrofKeySource;
}

const ALLOWED_CROF_ENV_VARS = ["CROF_API_KEY", "CROFAI_API_KEY"] as const;
const CROF_PROVIDER_KEYS = ["crof"] as const;

export type CrofKeySource =
  | "env:CROF_API_KEY"
  | "env:CROFAI_API_KEY"
  | "opencode.json"
  | "opencode.jsonc"
  | "auth.json";

export { getGlobalOpencodeConfigCandidatePaths as getOpencodeConfigCandidatePaths } from "./api-key-resolver.js";

const crofApiKeyResolver = createProviderApiKeyResolver<CrofKeySource>({
  envVars: [
    { name: "CROF_API_KEY", source: "env:CROF_API_KEY" },
    { name: "CROFAI_API_KEY", source: "env:CROFAI_API_KEY" },
  ],
  providerKeys: CROF_PROVIDER_KEYS,
  allowedEnvVars: ALLOWED_CROF_ENV_VARS,
  configJsonSource: "opencode.json",
  configJsoncSource: "opencode.jsonc",
  getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
  auth: {
    readAuth: readAuthFile,
    authSource: "auth.json",
  },
});

export async function resolveCrofApiKey(): Promise<CrofApiKeyResult | null> {
  return crofApiKeyResolver.resolve();
}

export async function hasCrofApiKey(): Promise<boolean> {
  return crofApiKeyResolver.has();
}

export async function getCrofKeyDiagnostics(): Promise<{
  configured: boolean;
  source: CrofKeySource | null;
  checkedPaths: string[];
  authPaths: string[];
}> {
  return {
    ...(await crofApiKeyResolver.diagnostics()),
    authPaths: getAuthPaths(),
  };
}
