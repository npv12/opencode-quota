/**
 * The TUI plugin on a fake OpenCode host: its one typed command, its palette entry, the slots it
 * claims, and the minimal sidebar's colored percent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuotaSnapshot } from "../src/core/types.js";
import plugin from "../src/tui/index.tsx";
import { createFakeTuiHost, stubJsx } from "./helpers/fake-tui-host.js";
import { findAll, THEME, textLines, words } from "./helpers/jsx-tree.js";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");

const SNAPSHOT: QuotaSnapshot = {
  version: 6,
  providers: [
    {
      providerId: "anthropic",
      label: "Claude",
      rows: [
        {
          id: "anthropic.weekly",
          providerId: "anthropic",
          label: "7d",
          type: "quota",
          method: "remote_api",
          authority: "provider_reported",
          window: "week",
          prominence: "primary",
          percentRemaining: 12,
          resetsAt: new Date(NOW + 3.2 * 86_400_000).toISOString(),
        },
      ],
      checkedAtMs: NOW,
      refreshing: false,
      debug: [],
    },
  ],
  resetNotices: [],
  generatedAtMs: NOW,
  serverId: "server",
  revision: 1,
  words: {
    percent: "left",
    reset: "smart",
    resetDecimals: 1,
    rowNames: "short",
    detail: "summary",
    onlyCurrentModel: false,
    sessionTokens: "current",
  },
};

const emptySettings = {
  values: {},
  fromFile: [],
  providers: [],
  custom: [],
};

const refresh = vi.fn(async () => ({ snapshot: SNAPSHOT }));

function rpc() {
  return {
    snapshot: async () => ({ snapshot: SNAPSHOT }),
    refresh,
    usage: async () => ({ report: {} }),
    downloadPrices: async () => ({ ok: true, message: "" }),
    settings: async () => emptySettings,
    saveSettings: async () => ({ ok: true, issues: [] }),
    settingsSchema: async () => ({ rules: {}, path: "/tmp/opencode-quota/settings.jsonc" }),
    events: { on: () => () => {} },
  };
}

function host() {
  return createFakeTuiHost({
    rpc,
    route: { type: "session", sessionID: "ses_1" },
    theme: THEME,
  });
}

describe("quota TUI plugin", () => {
  beforeEach(() => {
    refresh.mockClear();
  });

  it("registers only the /quota typed command and its palette entry", async () => {
    const tui = host();
    stubJsx({ renderables: tui });
    await plugin.setup(tui.context as never);

    expect(tui.commands().map((command) => command.id)).toEqual(["quota.limits"]);
    expect(tui.typed("/quota_status")).toBe(false);
    expect(tui.typed("/quota 30d")).toBeUndefined();
    expect(tui.editor.clear).toHaveBeenCalledOnce();
    expect(tui.context.data.on).not.toHaveBeenCalled();
    // /quota opens the v6 window, not a report dialog.
    const window = tui.render("session.composer.top", { sessionID: "ses_1" });
    expect(words(window)).toEqual(expect.arrayContaining(["Limits", "Usage"]));
  });

  it("claims the sidebar and the window, and no status line or prompt slot", async () => {
    const tui = host();
    stubJsx({ renderables: tui });
    await plugin.setup(tui.context as never);

    expect(() => tui.render("sidebar.content", { sessionID: "ses_1" })).not.toThrow();
    expect(() => tui.render("session.composer.top", { sessionID: "ses_1" })).not.toThrow();
    expect(() => tui.render("prompt.footer", { sessionID: "ses_1" })).toThrow();
    expect(() => tui.render("home.footer.status")).toThrow();
  });

  it("colors the minimal sidebar's percent by the limit left", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const tui = host();
    stubJsx({ renderables: tui });
    await plugin.setup(tui.context as never);
    tui.typed("/quota");

    await vi.waitFor(() => {
      const sidebar = tui.render("sidebar.content", { sessionID: "ses_1" });
      expect(textLines(sidebar).join("")).toContain("Claude");
    });
    const sidebar = tui.render("sidebar.content", { sessionID: "ses_1" });
    expect(textLines(sidebar)).toEqual(["Quota", "  Claude               7d  3.2d  12%"]);
    const percent = findAll(
      sidebar,
      (node) => node.type === "span" && String(node.props?.children).includes("12%"),
    )[0];
    expect(percent?.props.style.fg).toBe("red");
    vi.useRealTimers();
  });

  it("refreshes from the title", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const tui = host();
    stubJsx({ renderables: tui });
    await plugin.setup(tui.context as never);
    await vi.waitFor(() => {
      const sidebar = tui.render("sidebar.content", { sessionID: "ses_1" });
      expect(textLines(sidebar)).toEqual(["Quota", "  Claude               7d  3.2d  12%"]);
    });

    const sidebar = tui.render("sidebar.content", { sessionID: "ses_1" });
    const clickable = (text: string) =>
      findAll(
        sidebar,
        (node) =>
          node.type === "text" &&
          typeof node.props?.onMouseDown === "function" &&
          textLines(node)[0] === text,
      )[0];
    clickable("Quota")?.props.onMouseDown();
    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "manual", sessionID: "ses_1" }),
      expect.anything(),
    );
    vi.useRealTimers();
  });
});
