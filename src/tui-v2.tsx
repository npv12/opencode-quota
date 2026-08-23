/** @jsxImportSource @opentui/solid */

import { RGBA } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createSignal, onCleanup, Show } from "solid-js";

import { sanitizeDisplayText } from "./lib/display-sanitize.js";
import {
  buildQuotaDialogCommandOutput,
  QUOTA_DIALOG_COMMANDS,
  type QuotaDialogCommandId,
} from "./lib/quota-dialog-commands.js";
import { resolveQuotaFormatStyle } from "./lib/quota-format-style.js";
import { collectQuotaRenderData } from "./lib/quota-render-data.js";
import {
  createQuotaRuntimeRequestContext,
  type QuotaSessionModelContext,
  resolveQuotaRuntimeContext,
} from "./lib/quota-runtime-context.js";
import { buildSidebarQuotaPanelLines } from "./lib/tui-sidebar-format.js";

const terminalForeground = RGBA.defaultForeground();

type TuiEvent = { data?: Record<string, unknown> };
type TuiContext = {
  client: unknown;
  data: {
    on: (event: string, handler: (event: TuiEvent) => void) => () => void;
    session: {
      get: (sessionID: string) => unknown;
      status: (sessionID: string) => string;
      cost: (sessionID: string) => number;
      message: {
        list: (sessionID: string) => unknown[];
      };
    };
    location: {
      model: {
        list: (location?: string) => unknown[];
      };
    };
  };
  keymap: {
    layer: (
      build: () => {
        mode: "global";
        commands: Array<{
          id: string;
          title: string;
          group: string;
          palette: true;
          slash: { name: string };
          run: (input?: unknown) => void;
        }>;
      },
    ) => void;
  };
  ui: {
    slot: (
      claim:
        | { append: "app"; render: () => null }
        | { append: "sidebar.content"; render: (props: { sessionID: string }) => JSX.Element },
    ) => () => void;
    dialog: {
      alert: (params: { title: string; message: string }) => Promise<unknown>;
      prompt: (params: { title: string; placeholder?: string }) => Promise<string | undefined>;
      set: (params: { size: "medium" | "large" | "xlarge" }) => void;
    };
  };
};

function getSessionID(event: TuiEvent): string | undefined {
  const sessionID = event.data?.sessionID;
  return typeof sessionID === "string" && sessionID ? sessionID : undefined;
}

async function getSessionModelMeta(
  client: unknown,
  sessionID: string,
): Promise<QuotaSessionModelContext> {
  const session = (
    client as { session?: { get?: (input: { sessionID: string }) => Promise<{ data?: unknown }> } }
  ).session;
  const response = await session?.get?.({ sessionID });
  const model = (response?.data as { model?: { id?: string; providerID?: string } } | undefined)
    ?.model;
  return model ? { modelID: model.id, providerID: model.providerID } : {};
}

function createClientAdapter(context: TuiContext) {
  const { resolve } = require("node:path");
  const { readFileSync, existsSync } = require("node:fs");
  
  const configRootDir = process.cwd();
  let configPromise: Promise<any> | undefined;
  let providerIdsPromise: Promise<string[]> | undefined;

  function loadConfigFile(filePath: string): any {
    try {
      if (!existsSync(filePath)) return null;
      const content = readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  function loadConfiguredOpenCodeConfig(): any {
    const candidates = [
      resolve(configRootDir, "opencode.jsonc"),
      resolve(configRootDir, "opencode.json"),
    ];
    for (const path of candidates) {
      const config = loadConfigFile(path);
      if (config) return config;
    }
    return {};
  }

  function loadConfiguredProviderIds(): string[] {
    const config = loadConfiguredOpenCodeConfig();
    const providers = config?.provider;
    if (!providers) return [];
    if (typeof providers === "string") return [providers];
    if (Array.isArray(providers)) return providers;
    if (typeof providers === "object") return Object.keys(providers);
    return [];
  }

  return {
    config: {
      get: async () => {
        configPromise ??= Promise.resolve(loadConfiguredOpenCodeConfig());
        return { data: await configPromise };
      },
      providers: async () => {
        providerIdsPromise ??= (async () => {
          const ids = loadConfiguredProviderIds();
          return ids;
        })();
        const ids = await providerIdsPromise;
        return {
          data: {
            providers: ids.map((id) => ({ id })),
          },
        };
      },
    },
    session: context.client && typeof (context.client as any).session?.get === "function"
      ? (context.client as any).session
      : {
          get: async (input: { sessionID: string }) => {
            const session = context.data.session.get(input.sessionID) as {
              model?: { id?: string; providerID?: string };
            };
            return { data: session };
          },
        },
  };
}

async function getSidebarQuotaMessage(
  context: TuiContext,
  sessionID: string,
): Promise<string[] | undefined> {
  const client = createClientAdapter(context);
  const runtime = await resolveQuotaRuntimeContext({
    client: client as never,
    roots: { fallbackDirectory: process.cwd() },
    sessionID,
    resolveSessionMeta: (id) => getSessionModelMeta(client, id),
    includeSessionMeta: (config) => config.onlyCurrentModel,
  });
  const config = runtime.config;
  if (!config.enabled || !config.tuiSidebarPanel.enabled) return;

  const formatStyle = resolveQuotaFormatStyle(config.formatStyle);
  const result = await collectQuotaRenderData({
    client: runtime.client,
    resolveRuntimeProviderIds: runtime.resolveRuntimeProviderIds,
    config,
    configMeta: runtime.configMeta,
    request: createQuotaRuntimeRequestContext(runtime),
    surfaceExplicitProviderIssues: true,
    formatStyle,
    providers: runtime.providers,
  });
  
  if (!result.data) return;
  
  return buildSidebarQuotaPanelLines({
    data: result.data,
    config: {
      ...config,
      formatStyle: config.tuiSidebarPanel.formatStyle
        ? resolveQuotaFormatStyle(config.tuiSidebarPanel.formatStyle)
        : formatStyle,
    },
  });
}

function reportFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[opencode-quota] failed to load quota: ${message}`);
}

function getCommandArguments(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ["arguments", "args", "query"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

async function runQuotaCommand(
  context: TuiContext,
  command: QuotaDialogCommandId,
  sessionID: string | undefined,
  input?: unknown,
): Promise<void> {
  const spec = QUOTA_DIALOG_COMMANDS.find((item) => item.id === command)!;
  let argumentsText = getCommandArguments(input);
  if (spec.acceptsArguments && argumentsText === undefined) {
    const value = await context.ui.dialog.prompt({
      title: spec.title,
      placeholder: "Optional arguments",
    });
    if (value === undefined) return;
    argumentsText = value.trim() || undefined;
  }

  try {
    const client = createClientAdapter(context);
    const result = await buildQuotaDialogCommandOutput({
      command,
      arguments: argumentsText,
      client: client as never,
      roots: { fallbackDirectory: process.cwd() },
      sessionID,
      resolveSessionMeta: (id) => getSessionModelMeta(client, id),
    });
    if (result.state === "noop") return;
    const alert = context.ui.dialog.alert({ title: result.title, message: result.output });
    context.ui.dialog.set({ size: result.dialogSize });
    await alert;
  } catch (error) {
    console.error(`[opencode-quota] command failed:`, error);
  }
}

function registerQuotaCommands(context: TuiContext, getSessionID: () => string | undefined): void {
  context.keymap.layer(() => ({
    mode: "global",
    commands: QUOTA_DIALOG_COMMANDS.map((spec) => ({
      id: `quota.${spec.id}`,
      title: spec.title,
      group: "Quota",
      palette: true,
      slash: { name: spec.slashName },
      run: (input?: unknown) => void runQuotaCommand(context, spec.id, getSessionID(), input),
    })),
  }));
}

function SidebarQuotaView(props: {
  context: TuiContext;
  sessionID: string;
  setActiveSessionID: (sessionID: string) => void;
}): JSX.Element {
  props.setActiveSessionID(props.sessionID);
  const [open, setOpen] = createSignal(true);
  const [lines, setLines] = createSignal<string[]>([]);
  const refresh = () => {
    void getSidebarQuotaMessage(props.context, props.sessionID)
      .then((result) => setLines(result ?? []))
      .catch(reportFailure);
  };
  refresh();
  const unsubscribe = props.context.data.on("session.step.ended", (event) => {
    if (getSessionID(event) === props.sessionID) refresh();
  });
  onCleanup(unsubscribe);

  return (
    <box flexDirection="column">
      <box
        flexDirection="row"
        gap={1}
        onMouseDown={() => lines().length > 0 && setOpen((value) => !value)}
      >
        <Show when={lines().length > 0}>
          <text fg={terminalForeground}>{open() ? "▼" : "▶"}</text>
        </Show>
        <text fg={terminalForeground}>
          <b>Quota</b>
        </text>
      </box>
      <Show when={lines().length > 0} fallback={<text fg={terminalForeground}>No quota data</text>}>
        <Show when={open() || lines().length <= 2}>
          {lines().map((line) => (
            <text fg={terminalForeground} wrapMode="none">
              {line || " "}
            </text>
          ))}
        </Show>
      </Show>
    </box>
  );
}

const plugin = {
  id: "@slkiser/opencode-quota",
  setup(context: TuiContext) {
    let activeSessionID: string | undefined;
    const disposeApp = context.ui.slot({
      append: "app",
      render: () => {
        registerQuotaCommands(context, () => activeSessionID);
        return null;
      },
    });
    const disposeSidebar = context.ui.slot({
      append: "sidebar.content",
      render: (props) => (
        <SidebarQuotaView
          context={context}
          sessionID={props.sessionID}
          setActiveSessionID={(sessionID) => {
            activeSessionID = sessionID;
          }}
        />
      ),
    });
    return () => {
      disposeApp();
      disposeSidebar();
    };
  },
};

export default plugin;
