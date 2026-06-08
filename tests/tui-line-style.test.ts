import { describe, expect, it } from "vitest";

import { getSidebarBodyLineColor } from "../src/lib/tui-line-style.js";

describe("getSidebarBodyLineColor", () => {
  const theme = {
    text: "white",
    textMuted: "gray",
  };

  it("uses muted text color for sidebar lines", () => {
    expect(getSidebarBodyLineColor("Some line", theme)).toBe("gray");
  });

  it("uses muted text color for empty lines", () => {
    expect(getSidebarBodyLineColor("", theme)).toBe("gray");
  });
});
