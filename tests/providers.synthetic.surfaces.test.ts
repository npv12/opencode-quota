import { describe, expect, it } from "vitest";

import type { QuotaRenderData } from "../src/lib/quota-render-data.js";
import { renderAccountingSurfaces } from "./helpers/accounting-surfaces.js";

const EMPTY_OBJECT_DIAGNOSTIC = "Synthetic returned no quota data for this account.";

const emptyObjectData: QuotaRenderData = {
  entries: [],
  errors: [{ label: "Synthetic", message: EMPTY_OBJECT_DIAGNOSTIC }],
};

describe("Synthetic empty-object provider surface formatting", () => {
  it("shows the no-quota diagnostic without fabricating rows or auth inference", () => {
    const outputs = renderAccountingSurfaces({
      data: emptyObjectData,
      accountingDetail: "summary",
      showMaxWidth: 64,
      showNarrowAt: 44,
    });

    for (const output of Object.values(outputs)) {
      expect(output.replaceAll("\n", " ")).toContain(EMPTY_OBJECT_DIAGNOSTIC);
      expect(output).not.toContain("5h:");
      expect(output).not.toContain("Weekly:");
      expect(output).not.toContain("0/0");
      expect(output).not.toContain("$0/$0");
      expect(output).not.toContain("Clerk");
      expect(output).not.toContain("invalid");
      expect(output).not.toContain("subscription");
      expect(output).not.toMatch(/[█░]/u);
    }
  });
});
