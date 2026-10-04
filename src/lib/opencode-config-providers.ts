import {
  dedupeNonEmptyStrings,
  extractPluginSpecsFromParsedConfig,
  extractProviderIdsFromParsedConfig,
} from "./config-file-utils.js";
import {
  buildOpenCodeConfigCandidates,
  type OpenCodeConfigCandidate,
  readOpenCodeConfigCandidate,
  selectFirstExistingOpenCodeConfigCandidate,
} from "./opencode-config-read.js";
import { getOpencodeRuntimeDirs } from "./opencode-runtime-paths.js";

export interface LoadConfiguredProviderIdsOptions {
  configRootDir: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getCandidates(configRootDir: string): OpenCodeConfigCandidate[] {
  return dedupeNonEmptyStrings([getOpencodeRuntimeDirs().configDir, configRootDir]).flatMap(
    (directory) => {
      const selected = selectFirstExistingOpenCodeConfigCandidate(
        buildOpenCodeConfigCandidates({
          directories: [directory],
          formatOrder: ["jsonc", "json"],
        }),
      );
      return selected ? [selected] : [];
    },
  );
}

async function readConfig(
  candidate: OpenCodeConfigCandidate,
): Promise<Record<string, unknown> | null> {
  const result = await readOpenCodeConfigCandidate(candidate);
  return result.state === "parsed" && isRecord(result.value) ? result.value : null;
}

const COMPANION_PLUGIN_PROVIDER_IDS: ReadonlyArray<{
  providerId: string;
  matches: readonly string[];
}> = [
  { providerId: "google-gemini-cli", matches: ["opencode-gemini-auth"] },
  { providerId: "cursor", matches: ["cursor-opencode-provider"] },
];

function mergeOpenCodeConfig(
  base: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...base, ...next };

  if (isRecord(base.provider) || isRecord(next.provider)) {
    merged.provider = {
      ...(isRecord(base.provider) ? base.provider : {}),
      ...(isRecord(next.provider) ? next.provider : {}),
    };
  }

  if (isRecord(base.providers) || isRecord(next.providers)) {
    merged.providers = {
      ...(isRecord(base.providers) ? base.providers : {}),
      ...(isRecord(next.providers) ? next.providers : {}),
    };
  }

  if (Array.isArray(base.plugin) || Array.isArray(next.plugin)) {
    merged.plugin = [
      ...(Array.isArray(base.plugin) ? base.plugin : []),
      ...(Array.isArray(next.plugin) ? next.plugin : []),
    ];
  }

  if (Array.isArray(base.plugins) || Array.isArray(next.plugins)) {
    merged.plugins = [
      ...(Array.isArray(base.plugins) ? base.plugins : []),
      ...(Array.isArray(next.plugins) ? next.plugins : []),
    ];
  }

  return merged;
}

function inferProviderIdsFromPluginSpecs(specs: string[]): string[] {
  const normalizedSpecs = specs.map((spec) => spec.replace(/\\/g, "/").toLowerCase());
  return COMPANION_PLUGIN_PROVIDER_IDS.flatMap(({ providerId, matches }) =>
    normalizedSpecs.some((spec) => matches.some((match) => spec.includes(match)))
      ? [providerId]
      : [],
  );
}

export async function loadConfiguredOpenCodeConfig(
  options: LoadConfiguredProviderIdsOptions,
): Promise<Record<string, unknown>> {
  let config: Record<string, unknown> = {};

  for (const candidate of getCandidates(options.configRootDir)) {
    const parsed = await readConfig(candidate);
    if (!parsed) {
      continue;
    }
    config = mergeOpenCodeConfig(config, parsed);
  }

  return config;
}

export async function loadConfiguredProviderIds(
  options: LoadConfiguredProviderIdsOptions,
): Promise<string[]> {
  const config = await loadConfiguredOpenCodeConfig(options);
  return dedupeNonEmptyStrings([
    ...extractProviderIdsFromParsedConfig(config),
    ...inferProviderIdsFromPluginSpecs(extractPluginSpecsFromParsedConfig(config)),
  ]);
}
