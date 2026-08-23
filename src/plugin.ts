/**
 * OpenCode Quota Plugin
 *
 * Provides /quota command and sidebar panel for quota visibility.
 */

import { isMainThread } from "node:worker_threads";
import type { Plugin } from "@opencode-ai/plugin";
import { findGitWorktreeRoot, getEffectiveConfigRoot } from "./lib/config-file-utils.js";
import { sanitizeDisplayText } from "./lib/display-sanitize.js";
import {
  buildQuotaDialogCommandOutput,
  isQuotaDialogCommand,
  QUOTA_DIALOG_COMMANDS,
  type QuotaDialogCommandId,
} from "./lib/quota-dialog-commands.js";
import type { SessionModelMeta } from "./lib/quota-render-data.js";
import type { QuotaToastConfig } from "./lib/types.js";

interface OpencodeClient {
  config: {
    get: () => Promise<{
      data?: {
        model?: string;
        experimental?: {
          quotaToast?: Partial<QuotaToastConfig>;
        };
      };
    }>;
    providers: () => Promise<{
      data?: {
        providers: Array<{ id: string }>;
      };
    }>;
  };
  session: {
    get: (params: { path: { id: string } }) => Promise<{
      data?: {
        parentID?: string;
        model?: {
          id?: string;
          providerID?: string;
        };
      };
    }>;
    prompt: (params: {
      path: { id: string };
      body: {
        noReply?: boolean;
        parts: Array<{ type: "text"; text: string; ignored?: boolean }>;
      };
    }) => Promise<unknown>;
  };
  app: {
    log: (params: {
      body: {
        service: string;
        level: "debug" | "info" | "warn" | "error";
        message: string;
        extra?: Record<string, unknown>;
      };
    }) => Promise<unknown>;
  };
}

interface PluginEvent {
  type: string;
  properties: {
    sessionID?: string;
    [key: string]: unknown;
  };
}

interface PluginConfigInput {
  command?: Record<string, { template: string; description: string }>;
  agent?: Record<string, unknown>;
  default_agent?: string;
}

function normalizeDefaultAgent(cfg: PluginConfigInput | null | undefined): void {
  if (!cfg?.default_agent || !cfg.agent || cfg.default_agent in cfg.agent) return;

  const stripped = (value: string) => value.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
  const target = stripped(cfg.default_agent);
  const matches = Object.keys(cfg.agent).filter((key) => stripped(key) === target);
  if (matches.length === 1) {
    cfg.default_agent = matches[0];
  }
}

interface CommandExecuteInput {
  command: string;
  arguments?: string;
  sessionID: string;
}

export const QuotaToastPlugin: Plugin = async ({ client, directory }) => {
  const typedClient = client as unknown as OpencodeClient;
  let opencodeConfig: PluginConfigInput | null = null;

  async function injectRawOutput(
    sessionID: string,
    output: string,
    options: { rethrow?: boolean } = {},
  ): Promise<void> {
    normalizeDefaultAgent(opencodeConfig);

    try {
      await typedClient.session.prompt({
        path: { id: sessionID },
        body: {
          noReply: true,
          parts: [{ type: "text", text: sanitizeDisplayText(output), ignored: true }],
        },
      });
    } catch (err) {
      await typedClient.app.log({
        body: {
          service: "quota",
          level: "warn",
          message: "Failed to inject raw output",
          extra: { error: err instanceof Error ? err.message : String(err) },
        },
      });
      if (options.rethrow) {
        throw err;
      }
    }
  }

  function getPluginRuntimeRootHints() {
    const cwd = directory || process.cwd();
    const workspaceRoot = findGitWorktreeRoot(cwd) ?? cwd;
    const configRoot = getEffectiveConfigRoot(workspaceRoot);
    return {
      workspaceRoot,
      configRoot,
      fallbackDirectory: cwd,
    };
  }

  function registerDeterministicSlashCommands(cfg: PluginConfigInput): void {
    cfg.command ??= {};

    for (const spec of QUOTA_DIALOG_COMMANDS) {
      cfg.command[spec.id] = {
        template: `/${spec.slashName}`,
        description: spec.description,
      };
    }
  }

  async function handleDeterministicSlashCommand(input: CommandExecuteInput): Promise<never> {
    const command = input.command as QuotaDialogCommandId;
    const result = await buildQuotaDialogCommandOutput({
      command,
      arguments: input.arguments,
      client: typedClient,
      roots: getPluginRuntimeRootHints(),
      sessionID: input.sessionID,
      resolveSessionMeta: (sessionID) => getSessionModelMeta(sessionID),
    });

    if (result.state === "output") {
      await injectRawOutput(input.sessionID, result.output, { rethrow: true });
    }

    // Signal that the command was handled
    return undefined as never;
  }

  async function log(message: string, extra?: Record<string, unknown>): Promise<void> {
    try {
      await typedClient.app.log({
        body: {
          service: "quota",
          level: "debug",
          message,
          extra,
        },
      });
    } catch {
      // Ignore logging errors
    }
  }

  async function getSessionModelMeta(sessionID?: string): Promise<SessionModelMeta> {
    if (!sessionID) return {};
    try {
      const sessionResp = await typedClient.session.get({ path: { id: sessionID } });
      return {
        modelID: sessionResp.data?.model?.id,
        providerID: sessionResp.data?.model?.providerID,
      };
    } catch {
      return {};
    }
  }

  return {
    config: async (input: unknown) => {
      const cfg = input as PluginConfigInput;
      opencodeConfig = cfg;
      if (isMainThread) {
        registerDeterministicSlashCommands(cfg);
      }
      normalizeDefaultAgent(cfg);
    },

    "command.execute.before": async (input: CommandExecuteInput) => {
      if (!isQuotaDialogCommand(input.command)) return;
      await handleDeterministicSlashCommand(input);
    },
  };
};

export default QuotaToastPlugin;
