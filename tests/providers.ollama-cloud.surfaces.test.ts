import { describe, expect, it } from "vitest";

import { formatQuotaRows } from "../src/lib/format.js";
import { formatQuotaCommand } from "../src/lib/quota-command-format.js";
import type { QuotaRenderData } from "../src/lib/quota-render-data.js";
import { buildSidebarQuotaPanelLines } from "../src/lib/tui-sidebar-format.js";

const accounting = {
  acquisitionMethod: "remote_api",
  ownership: "maintained",
  authority: "provider_reported",
} as const;

const data: QuotaRenderData = {
  entries: [
    {
      accounting: { resultType: "quota", ...accounting },
      name: "Ollama Cloud Session",
      group: "Ollama Cloud",
      label: "Session:",
      percentRemaining: 75,
    },
    {
      accounting: { resultType: "quota", ...accounting },
      name: "Ollama Cloud Weekly",
      group: "Ollama Cloud",
      label: "Weekly:",
      percentRemaining: 60,
    },
  ],
  errors: [],
};

describe("Ollama Cloud provider surface formatting", () => {
  it("shows Ollama Cloud quota on command, show, and sidebar output", () => {
    const command = formatQuotaCommand({ ...data, generatedAtMs: 0 });
    const show = formatQuotaRows({ version: "test", style: "allWindows", ...data });
    const sidebar = buildSidebarQuotaPanelLines({
      data,
      config: { percentDisplayMode: "remaining" },
    }).join("\n");

    for (const output of [command, show]) {
      expect(output).toContain("Ollama Cloud");
      expect(output).toContain("75%");
      expect(output).not.toContain("requests");
    }
    expect(sidebar).toContain("Ollama Cloud");
    expect(sidebar).toContain("7d");
    expect(sidebar).toContain("60%");
    expect(sidebar).not.toContain("75%");
    expect(sidebar).not.toContain("requests");
  });

  it("shows the Ollama Cloud monthly usage pool on command, show, and sidebar output", () => {
    const monthlyData: QuotaRenderData = {
      entries: [
        {
          accounting: { resultType: "quota", ...accounting },
          name: "Ollama Cloud Monthly",
          group: "Ollama Cloud",
          label: "Monthly:",
          percentRemaining: 96,
        },
      ],
      errors: [],
    };
    const command = formatQuotaCommand({ ...monthlyData, generatedAtMs: 0 });
    const show = formatQuotaRows({ version: "test", style: "allWindows", ...monthlyData });
    const sidebar = buildSidebarQuotaPanelLines({
      data: monthlyData,
      config: { percentDisplayMode: "remaining" },
    }).join("\n");

    for (const output of [command, show, sidebar]) {
      expect(output).toContain("Ollama Cloud");
      expect(output).toContain("96%");
    }
  });
});
