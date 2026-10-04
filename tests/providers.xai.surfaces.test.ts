import { describe, expect, it } from "vitest";
import { formatQuotaRows } from "../src/lib/format.js";
import { formatQuotaCommand } from "../src/lib/quota-command-format.js";
import type { QuotaRenderData } from "../src/lib/quota-render-data.js";
import { buildSidebarQuotaPanelLines } from "../src/lib/tui-sidebar-format.js";

const xaiLabels = ["xAI Lite", "xAI SuperGrok", "xAI Heavy"] as const;

function renderDataForLabel(label: (typeof xaiLabels)[number]): QuotaRenderData {
  return {
    entries: [
      {
        accounting: {
          resultType: "quota",
          acquisitionMethod: "remote_api",
          ownership: "maintained",
          authority: "provider_reported",
        },
        name: `${label} Weekly`,
        group: label,
        label: "Weekly:",
        percentRemaining: 95,
        resetTimeIso: "2099-08-01T00:00:00.000Z",
      },
    ],
    errors: [],
  };
}

describe("xAI provider surface formatting", () => {
  it.each([
    "[xAI] (SuperGrok) (active)",
    "[xAI personal] (SuperGrok) (active)",
  ])("preserves the credential group %s on command and show with a simple sidebar provider", (group) => {
    const data: QuotaRenderData = {
      entries: [
        {
          ...renderDataForLabel("xAI SuperGrok").entries[0]!,
          name: `${group} Weekly`,
          group,
        },
      ],
      errors: [],
    };
    const command = formatQuotaCommand({ ...data, generatedAtMs: 0 });
    const show = formatQuotaRows({ version: "test", style: "allWindows", ...data });
    const sidebar = buildSidebarQuotaPanelLines({
      data,
      config: { percentDisplayMode: "remaining" },
    }).join("\n");

    for (const output of [command, show]) expect(output).toContain(group);
    expect(sidebar).toContain("xAI");
    expect(sidebar).toContain("95%");
  });

  it.each(xaiLabels)("shows the %s weekly quota in command, show, and sidebar output", (label) => {
    const data = renderDataForLabel(label);
    const command = formatQuotaCommand({ ...data, generatedAtMs: 0 });
    const show = formatQuotaRows({ version: "test", style: "allWindows", ...data });
    const sidebar = buildSidebarQuotaPanelLines({
      data,
      config: { percentDisplayMode: "remaining" },
    }).join("\n");

    for (const output of [command, show]) {
      expect(output).toContain("95%");
      expect(output).toContain(label);
    }
    expect(sidebar).toContain("95%");
    expect(sidebar).toContain("7d");
  });
});
