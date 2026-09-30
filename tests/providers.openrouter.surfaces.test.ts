import { describe, expect, it } from "vitest";

import { formatQuotaRows } from "../src/lib/format.js";
import { formatQuotaCommand } from "../src/lib/quota-command-format.js";
import type { QuotaRenderData } from "../src/lib/quota-render-data.js";
import { buildSidebarQuotaPanelLines } from "../src/lib/tui-sidebar-format.js";

const data: QuotaRenderData = {
  entries: [
    {
      accounting: {
        resultType: "budget",
        acquisitionMethod: "remote_api",
        ownership: "maintained",
        authority: "provider_reported",
      },
      name: "OpenRouter budget",
      group: "OpenRouter",
      label: "Budget:",
      percentRemaining: 80,
      right: "$2.00/$10.00",
    },
  ],
  errors: [],
};

describe("OpenRouter provider surface formatting", () => {
  it("shows OpenRouter budget on command, show, and sidebar output", () => {
    const command = formatQuotaCommand({ ...data, generatedAtMs: 0 });
    const show = formatQuotaRows({ version: "test", style: "allWindows", ...data });
    const sidebar = buildSidebarQuotaPanelLines({
      data,
      config: { percentDisplayMode: "remaining" },
    }).join("\n");

    for (const output of [command, show, sidebar]) {
      expect(output).toContain("OpenRouter");
      expect(output).toContain("80%");
      expect(output).not.toContain("reset");
    }
    expect(sidebar).toMatch(/^OpenRouter\s+80%$/u);
  });
});
