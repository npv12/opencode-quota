import type { RuntimeContextRootHints } from "./config-file-utils.js";
import { sanitizeDisplayText } from "./display-sanitize.js";
import { collectQuotaRenderData } from "./quota-render-data.js";
import {
  createQuotaRuntimeRequestContext,
  type QuotaRuntimeClient,
  type QuotaSessionModelContext,
  resolveQuotaRuntimeContext,
} from "./quota-runtime-context.js";
import { buildSidebarQuotaPanelLines } from "./tui-sidebar-format.js";

export type QuotaSurfaceHost = {
  client: QuotaRuntimeClient;
  roots: RuntimeContextRootHints;
  resolveSessionMeta: (sessionID: string) => Promise<QuotaSessionModelContext>;
};

export async function getQuotaMessage(
  host: QuotaSurfaceHost,
  sessionID: string,
): Promise<{ message: string } | undefined> {
  const runtime = await resolveQuotaRuntimeContext({
    client: host.client,
    roots: host.roots,
    sessionID,
    resolveSessionMeta: host.resolveSessionMeta,
    includeSessionMeta: (config) => config.onlyCurrentModel,
  });
  const config = runtime.config;
  if (!config.enabled || !config.tuiSidebarPanel.enabled) return;

  const result = await collectQuotaRenderData({
    client: runtime.client,
    resolveRuntimeProviderIds: runtime.resolveRuntimeProviderIds,
    config,
    configMeta: runtime.configMeta,
    request: createQuotaRuntimeRequestContext(runtime),
    workspaceRoot: runtime.roots.workspaceRoot,
    surfaceExplicitProviderIssues: true,
    formatStyle: "allWindows",
    providers: runtime.providers,
  });
  if (!result.data) return;
  const message = buildSidebarQuotaPanelLines({ data: result.data, config }).join("\n");
  return message ? { message: sanitizeDisplayText(message) } : undefined;
}
