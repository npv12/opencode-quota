import { formatQuotaRows } from "../../src/lib/format.js";
import { formatQuotaCommand } from "../../src/lib/quota-command-format.js";
import type { QuotaRenderData } from "../../src/lib/quota-render-data.js";
import { buildSidebarQuotaPanelLines } from "../../src/lib/tui-sidebar-format.js";
import type { QuotaToastConfig } from "../../src/lib/types.js";

export function renderAccountingSurfaces(params: {
  data: QuotaRenderData;
  accountingDetail: QuotaToastConfig["accountingDetail"];
  showMaxWidth: number;
  showNarrowAt: number;
}): {
  command: string;
  show: string;
  sidebar: string;
} {
  const { accountingDetail, showMaxWidth, showNarrowAt } = params;
  // accountingDetail filters supplementary entries at collection time, before the surfaces format them.
  const entries = params.data.entries.filter(
    (entry) =>
      !entry.semantic || accountingDetail === "detailed" || entry.semantic.prominence === "primary",
  );
  const data: QuotaRenderData = { ...params.data, entries };

  return {
    command: formatQuotaCommand({
      ...data,
      generatedAtMs: 0,
      accountingDetail,
      percentDisplayMode: "remaining",
    }),
    show: formatQuotaRows({
      version: "test",
      style: "allWindows",
      layout: { maxWidth: showMaxWidth, narrowAt: showNarrowAt, tinyAt: 32 },
      entries: data.entries,
      errors: data.errors,
      accountingDetail,
      percentDisplayMode: "remaining",
    }),
    sidebar: buildSidebarQuotaPanelLines({
      data,
      config: { percentDisplayMode: "remaining" },
    }).join("\n"),
  };
}
