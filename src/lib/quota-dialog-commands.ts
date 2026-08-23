import { formatQuotaRows } from "./format.js";
import { ALL_WINDOWS_FORMAT_STYLE } from "./quota-format-style.js";
import {
  type CollectQuotaRenderDataResult,
  collectQuotaRenderData,
  type SessionModelMeta,
} from "./quota-render-data.js";
import {
  createQuotaRuntimeRequestContext,
  type QuotaRuntimeClient,
  type QuotaRuntimeContext,
  resolveQuotaRuntimeContext,
} from "./quota-runtime-context.js";
import type { RuntimeContextRootHints } from "./config-file-utils.js";

export type QuotaDialogCommandId = "quota";

export type QuotaDialogCommandSpec = {
  id: QuotaDialogCommandId;
  slashName: string;
  title: string;
  description: string;
  dialogSize: "medium" | "large" | "xlarge";
  requiresSession?: boolean;
  acceptsArguments?: boolean;
};

export type QuotaDialogCommandOutputResult =
  | {
      state: "output";
      command: QuotaDialogCommandId;
      title: string;
      output: string;
      dialogSize: "medium" | "large" | "xlarge";
    }
  | {
      state: "noop";
      command: QuotaDialogCommandId;
      reason: "disabled";
    };

export const QUOTA_DIALOG_COMMANDS: readonly QuotaDialogCommandSpec[] = [
  {
    id: "quota",
    slashName: "quota",
    title: "Quota",
    description: "Show current quota",
    dialogSize: "xlarge",
    requiresSession: true,
  },
] as const;

const QUOTA_DIALOG_COMMANDS_BY_ID: ReadonlyMap<QuotaDialogCommandId, QuotaDialogCommandSpec> =
  (() => {
    const map = new Map<QuotaDialogCommandId, QuotaDialogCommandSpec>();
    for (const spec of QUOTA_DIALOG_COMMANDS) {
      map.set(spec.id, spec);
    }
    return map;
  })();

export function isQuotaDialogCommand(command: string): command is QuotaDialogCommandId {
  return QUOTA_DIALOG_COMMANDS_BY_ID.has(command as QuotaDialogCommandId);
}

function buildQuotaCommandUnavailableMessage(result: CollectQuotaRenderDataResult): string {
  const selection = result.selection;
  if (!selection) {
    return "Quota unavailable\n\nNo enabled quota providers are configured.";
  }

  if (selection.filteringByCurrentSelection && selection.filtered.length === 0) {
    return "Quota unavailable\n\nNo enabled quota providers matched the current session.";
  }

  const availableIds = result.availability
    .filter((item) => item.ok)
    .map((item) => item.provider.id);

  if (availableIds.length === 0) {
    return "Quota unavailable\n\nNo provider data available. Make sure you are logged in to a supported provider.";
  }

  return (
    `Quota unavailable\n\nNo provider data available for detected providers (${availableIds.join(", ")}). ` +
    "This may be a temporary API error."
  );
}

function outputResult(params: {
  command: QuotaDialogCommandId;
  output: string;
}): QuotaDialogCommandOutputResult {
  const spec = QUOTA_DIALOG_COMMANDS_BY_ID.get(params.command)!;
  return {
    state: "output",
    command: params.command,
    title: spec.title,
    output: params.output,
    dialogSize: spec.dialogSize,
  };
}

export async function buildQuotaDialogCommandOutput(params: {
  command: QuotaDialogCommandId;
  arguments?: string;
  client: QuotaRuntimeClient;
  roots: RuntimeContextRootHints;
  sessionID?: string;
  sessionMeta?: SessionModelMeta;
  resolveSessionMeta?: (sessionID: string) => Promise<SessionModelMeta>;
  generatedAtMs?: number;
}): Promise<QuotaDialogCommandOutputResult> {
  const generatedAtMs = params.generatedAtMs ?? Date.now();
  const runtime = await resolveQuotaRuntimeContext({
    client: params.client,
    roots: params.roots,
    sessionID: params.sessionID,
    sessionMeta: params.sessionMeta,
    resolveSessionMeta: params.resolveSessionMeta,
    includeSessionMeta: (config) => config.onlyCurrentModel,
  });

  if (!runtime.config.enabled) {
    return { state: "noop", command: params.command, reason: "disabled" };
  }

  const request = createQuotaRuntimeRequestContext(runtime);
  const quotaResult = await collectQuotaRenderData({
    client: runtime.client,
    resolveRuntimeProviderIds: runtime.resolveRuntimeProviderIds,
    config: runtime.config,
    configMeta: runtime.configMeta,
    request,
    surfaceExplicitProviderIssues: false,
    formatStyle: ALL_WINDOWS_FORMAT_STYLE,
    providers: runtime.providers,
  });

  if (
    !quotaResult.data ||
    (quotaResult.selection?.filteringByCurrentSelection &&
      quotaResult.selection.filtered.length === 0)
  ) {
    return outputResult({
      command: params.command,
      output: buildQuotaCommandUnavailableMessage(quotaResult),
    });
  }

  const output = formatQuotaRows({
    version: "2.0.0",
    layout: { maxWidth: 80, narrowAt: 60, tinyAt: 40 },
    entries: quotaResult.data.entries,
    errors: quotaResult.data.errors,
    style: ALL_WINDOWS_FORMAT_STYLE,
    percentDisplayMode: runtime.config.percentDisplayMode,
    resetTimeDecimals: runtime.config.resetTimeDecimals,
    sessionTokens: quotaResult.data.sessionTokens,
  });

  return outputResult({ command: params.command, output });
}
