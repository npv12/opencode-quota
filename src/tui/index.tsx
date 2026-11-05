/** @jsxImportSource @opentui/solid */
/**
 * OpenCode Quota's TUI plugin: the Quota panel in the session sidebar and the quota window that
 * `/quota` opens above the message box. It reads all settings through the quota RPC.
 */
import { Plugin } from "@opencode/plugin/tui";
import type { JSX } from "@opentui/solid";
import { onCleanup } from "solid-js";
import { QuotaRpc } from "../rpc.js";
import {
  type ClientHost,
  createQuotaClient,
  ownFolderEvents,
  quotaCallOptions,
  reportFailure,
} from "./client.js";
import { createFileDisplay } from "./display.js";
import { KEY_LAYERS } from "./key-layers.js";
import { createServerSettings } from "./server-settings.js";
import { SidebarPanel, type SurfaceHost } from "./sidebar.js";
import type { Theme } from "./theme.js";
import { createSettingsEditor } from "./window/settings.js";
import { createQuotaWindow, type WindowHost } from "./window/shell.js";

/** What the plugin needs from OpenCode's TUI context, besides the window's needs. */
type TuiContext = WindowHost &
  ClientHost & {
    theme: Theme & WindowHost["theme"];
    data: WindowHost["data"];
    ui: WindowHost["ui"] & {
      slot: (
        claim:
          | { append: "app"; render: () => null }
          | { append: "sidebar.content"; render: (props: { sessionID: string }) => JSX.Element }
          | {
              append: "session.composer.top";
              render: (props: { sessionID: string }) => JSX.Element;
            },
      ) => () => void;
    };
  };

const plugin = Plugin.define({
  id: "npv12.opencode-quota",
  setup(context) {
    const api = context as unknown as TuiContext;
    const server = createServerSettings({
      settings: () => api.client.rpc(QuotaRpc).settings({}, quotaCallOptions(api)),
      saveSettings: (input) => api.client.rpc(QuotaRpc).saveSettings(input, quotaCallOptions(api)),
    });
    const display = createFileDisplay(server);
    // `client`, `location` and `data` are read from OpenCode's context at each use, never copied.
    const quotaHost: ClientHost = {
      get client() {
        return api.client;
      },
      get location() {
        return api.location;
      },
      get data() {
        return api.data;
      },
      acceptsEventFrom: ownFolderEvents(api),
    };
    const quota = createQuotaClient(quotaHost, (_snapshot) => {
      const current = quota.snapshot()?.settings;
      if (current) server.receive(current);
    });
    const settings = createSettingsEditor(api, display);
    const host: SurfaceHost = {
      theme: () => api.theme,
      display: display.shown,
      quota,
      editing: settings,
    };
    const quotaWindow = createQuotaWindow(api, host, settings);
    const quotaCommands: Record<string, (argumentsText: string) => void> = {
      quota: () => quotaWindow.open("limits"),
    };

    let disposeMount: (() => void) | undefined;
    const disposeApp = api.ui.slot({
      append: "app",
      render: () => {
        // OpenCode mounts this slot again when it reconnects to its server, which can also
        // happen right after it starts. Leaving a mount drops its keymap layers and event
        // listeners, so each mount stops the last one's and registers everything again.
        disposeMount?.();
        const stopQuota = quota.start();
        // Load settings on Home too, including switches for otherwise hidden surfaces.
        queueMicrotask(() => {
          try {
            quota.watch()();
          } catch (error) {
            reportFailure(error);
          }
        });
        api.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "quota.limits",
              title: "Quota limits",
              group: "OpenCode Quota",
              palette: true,
              run: () => quotaWindow.open("limits"),
            },
          ],
        }));
        // The typed quota command. Above OpenCode's textarea layer, which submits the prompt on
        // Enter; without a mode, so it is off while the "/" list or a dialog is open.
        api.keymap.layer(() => ({
          priority: KEY_LAYERS.typedCommand,
          commands: [
            {
              bind: "return",
              // Synchronous on purpose: a returned promise counts as handled.
              run: () => {
                const editor = api.renderer.currentFocusedEditor;
                const trimmed = editor?.plainText.trim() ?? "";
                if (!editor || !trimmed.startsWith("/")) return false;
                // As in OpenCode, the command name ends at the first whitespace.
                const name = trimmed.slice(1).split(/\s/, 1)[0] ?? "";
                if (!Object.hasOwn(quotaCommands, name)) return false;
                editor.clear();
                quotaCommands[name](trimmed.slice(1 + name.length).trim());
              },
            },
          ],
        }));
        let disposed = false;
        const dispose = () => {
          if (disposed) return;
          disposed = true;
          if (disposeMount === dispose) disposeMount = undefined;
          stopQuota();
        };
        disposeMount = dispose;
        onCleanup(dispose);
        return null;
      },
    });
    const disposeSidebar = api.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarPanel host={host} sessionID={props.sessionID} />,
    });
    const disposeWindow = api.ui.slot({
      append: "session.composer.top",
      render: (props) => <quotaWindow.Slot sessionID={props.sessionID} />,
    });
    return () => {
      disposeMount?.();
      disposeApp();
      disposeSidebar();
      disposeWindow();
    };
  },
});

export default plugin;
