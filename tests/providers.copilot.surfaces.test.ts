import { describe, expect, it } from "vitest";
import { formatQuotaRows } from "../src/lib/format.js";
import { formatQuotaCommand } from "../src/lib/quota-command-format.js";
import type { QuotaRenderData } from "../src/lib/quota-render-data.js";
import { buildSidebarQuotaPanelLines } from "../src/lib/tui-sidebar-format.js";

const usageValue = "Used 100 | Included 80 | Billed 20 ($0.20)";

const data: QuotaRenderData = {
  entries: [
    {
      accounting: {
        resultType: "usage",
        acquisitionMethod: "remote_api",
        ownership: "maintained",
        authority: "provider_reported",
      },
      kind: "value",
      name: "Copilot AI Credits",
      group: "Copilot (personal)",
      label: "Credits:",
      value: usageValue,
    },
  ],
  errors: [],
};

describe("Copilot usage-only provider surface formatting", () => {
  it.each([
    "[Copilot] (business) (active)",
    "[Copilot sita] (business) (active)",
  ])("preserves the credential group %s on command and show with a canonical sidebar provider", (group) => {
    const credentialData: QuotaRenderData = {
      ...data,
      entries: data.entries.map((entry) => ({
        ...entry,
        name: entry.name.replace("Copilot", group),
        group,
      })),
    };
    const command = formatQuotaCommand({ ...credentialData, generatedAtMs: 0 });
    const show = formatQuotaRows({ version: "test", style: "allWindows", ...credentialData });
    const sidebar = buildSidebarQuotaPanelLines({
      data: credentialData,
      config: { percentDisplayMode: "remaining" },
    }).join("\n");

    for (const output of [command, show]) expect(output).toContain(group);
    expect(sidebar.slice(0, 13).trim()).toBe("Copilot");
    expect(sidebar).toContain("Used 100");
  });

  it("does not invent a remaining percentage or reset on any surface", () => {
    const web = formatQuotaCommand({ ...data, generatedAtMs: 0 });
    const show = formatQuotaRows({
      version: "test",
      style: "allWindows",
      layout: { maxWidth: 100, narrowAt: 42, tinyAt: 32 },
      ...data,
    });
    const sidebar = buildSidebarQuotaPanelLines({
      data,
      config: { percentDisplayMode: "remaining" },
    }).join("\n");

    for (const output of [web, show]) {
      expect(output).toContain("Copilot");
      expect(output).toContain("Used 100");
      expect(output).not.toMatch(/\d+%/u);
      expect(output).not.toContain("reset");
      expect(output).toContain(usageValue);
    }
    expect(sidebar.slice(0, 13).trim()).toBe("Copilot");
    expect(
      sidebar
        .split("\n")
        .map((line) => line.slice(25).trim())
        .join(" "),
    ).toBe(usageValue);
    expect(sidebar).toContain("Used 100");
    expect(sidebar).not.toMatch(/\d+%/u);
    expect(sidebar).not.toContain("reset");
  });
});
