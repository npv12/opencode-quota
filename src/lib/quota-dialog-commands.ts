import type { RuntimeContextRootHints } from "./config-file-utils.js";
import { isCursorProviderId } from "./cursor-pricing.js";
import { setPricingSnapshotAutoRefresh, setPricingSnapshotSelection } from "./modelsdev-pricing.js";
import { buildQuotaCommandDocument } from "./quota-command-format.js";
import {
  QUOTA_DIALOG_COMMANDS_BY_ID,
  type QuotaDialogCommandId,
  type QuotaDialogCommandOutputResult,
} from "./quota-dialog-command-specs.js";
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
import { messageDocument, type ReportDocument, renderPlainTextReport } from "./report-document.js";

/** A command's report: the document the TUI renders and the text everything else shows. */
type CommandReport = { document: ReportDocument; output: string };

function plainTextReport(document: ReportDocument): CommandReport {
  return { document, output: renderPlainTextReport(document) };
}

function describeQuotaCommandCurrentSelection(params: {
  currentModel?: string;
  currentProviderID?: string;
}): string {
  if (isCursorProviderId(params.currentProviderID)) {
    return `current provider: ${params.currentProviderID}`;
  }
  if (params.currentModel) {
    return `current model: ${params.currentModel}`;
  }
  return "current session";
}

function buildQuotaCommandUnavailableMessage(result: CollectQuotaRenderDataResult): string {
  const selection = result.selection;
  if (!selection) {
    return "Quota unavailable\n\nNo enabled quota providers are configured.";
  }

  if (selection.filteringByCurrentSelection && selection.filtered.length === 0) {
    const detail = describeQuotaCommandCurrentSelection({
      currentModel: selection.currentModel,
      currentProviderID: selection.currentProviderID,
    });
    return `Quota unavailable\n\nNo enabled quota providers matched the ${detail}.`;
  }

  const availableIds = result.availability
    .filter((item) => item.ok)
    .map((item) => item.provider.id);

  if (availableIds.length === 0) {
    const scopedDetail = selection.filteringByCurrentSelection
      ? ` for the ${describeQuotaCommandCurrentSelection({
          currentModel: selection.currentModel,
          currentProviderID: selection.currentProviderID,
        })}`
      : "";
    return (
      `Quota unavailable\n\nNo provider data available${scopedDetail}. ` +
      "Make sure you are logged in to a supported provider (Copilot, OpenAI, etc.)."
    );
  }

  return (
    `Quota unavailable\n\nNo provider data available for detected providers (${availableIds.join(", ")}). ` +
    "This may be a temporary API error."
  );
}

async function fetchQuotaCommandData(
  runtime: QuotaRuntimeContext,
): Promise<CollectQuotaRenderDataResult> {
  return collectQuotaRenderData({
    client: runtime.client,
    resolveRuntimeProviderIds: runtime.resolveRuntimeProviderIds,
    config: runtime.config,
    configMeta: runtime.configMeta,
    request: createQuotaRuntimeRequestContext(runtime),
    workspaceRoot: runtime.roots.workspaceRoot,
    surfaceExplicitProviderIssues: false,
    formatStyle: ALL_WINDOWS_FORMAT_STYLE,
    providers: runtime.providers,
  });
}

function outputResult(
  command: QuotaDialogCommandId,
  report: CommandReport,
): QuotaDialogCommandOutputResult {
  const spec = QUOTA_DIALOG_COMMANDS_BY_ID.get(command)!;
  return {
    state: "output",
    command,
    title: spec.title,
    output: report.output,
    document: report.document,
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

  setPricingSnapshotAutoRefresh(runtime.config.pricingSnapshot.autoRefresh);
  setPricingSnapshotSelection(runtime.config.pricingSnapshot.source);

  if (!runtime.config.enabled) {
    return { state: "noop", command: params.command, reason: "disabled" };
  }

  const reportData = await fetchQuotaCommandData(runtime);
  if (
    !reportData.data ||
    (reportData.selection?.filteringByCurrentSelection &&
      reportData.selection.filtered.length === 0)
  ) {
    return outputResult(
      params.command,
      plainTextReport(messageDocument(buildQuotaCommandUnavailableMessage(reportData))),
    );
  }

  return outputResult(
    params.command,
    plainTextReport(
      buildQuotaCommandDocument({
        ...reportData.data,
        generatedAtMs,
        percentDisplayMode: runtime.config.percentDisplayMode,
        percentLabelStyle: runtime.config.percentLabelStyle,
        accountingDetail: runtime.config.accountingDetail,
        resetTimeSpaced: runtime.config.resetTimeSpaced,
      }),
    ),
  );
}
