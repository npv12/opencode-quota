/**
 * OpenCode V2 server plugin: the /quota slash command for every client and the quota RPC
 * that computes the TUI sidebar. Inside OpenCode, logins are read only here, through
 * OpenCode's integration API.
 */
import { Plugin } from "@opencode/plugin";
import { resolveOpenCodeLocationRoots } from "./lib/config-file-utils.js";
import { sanitizeDisplayText } from "./lib/display-sanitize.js";
import {
  bindCredentialSource,
  createIntegrationCredentialSource,
  notifyCredentialsChanged,
  scrubCredentialErrorText,
} from "./lib/opencode-auth.js";
import {
  QUOTA_DIALOG_COMMANDS,
  type QuotaDialogCommandId,
} from "./lib/quota-dialog-command-specs.js";
import { buildQuotaDialogCommandOutput } from "./lib/quota-dialog-commands.js";
import {
  containsQuotaReport,
  formatQuotaReportMessage,
  QUOTA_REPORT_METADATA_KEY,
  type QuotaReportMetadata,
  removeQuotaReports,
} from "./lib/quota-report-message.js";
import { resolveQuotaResetRetryDelayMs } from "./lib/quota-retry-wait.js";
import type { QuotaSessionModelContext } from "./lib/quota-runtime-context.js";
import { getQuotaMessage, type QuotaSurfaceHost } from "./lib/quota-surface-data.js";
import { messageDocument } from "./lib/report-document.js";
import { QuotaRpc, type QuotaRpcCommandOutput } from "./rpc.js";

type ModelMessage = {
  readonly role: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string | null }>;
};

type ModelMessagePart = ModelMessage["content"][number];

function hasQuotaReportText(part: ModelMessagePart): boolean {
  return part.type === "text" && typeof part.text === "string" && containsQuotaReport(part.text);
}

/**
 * Drops quota report messages, found by their metadata, and cuts reports out of the text of
 * the remaining user messages. The cut covers compaction checkpoints, which hold copied
 * message text without its metadata, and title requests, which get plain text only.
 */
function withoutQuotaReports<M extends ModelMessage>(messages: M[]): M[] {
  return messages.flatMap((message): M[] => {
    if (message.role !== "user") return [message];
    if (message.metadata?.[QUOTA_REPORT_METADATA_KEY] !== undefined) return [];
    if (!message.content.some(hasQuotaReportText)) return [message];
    const content = message.content.map((part) =>
      hasQuotaReportText(part) ? { ...part, text: removeQuotaReports(part.text as string) } : part,
    );
    return [{ ...message, content }];
  });
}

/** An error as one line that is safe to log: tokens redacted, at most 120 characters. */
function logReason(error: unknown): string {
  return scrubCredentialErrorText(error instanceof Error ? error.message : String(error));
}

/**
 * Runs an RPC handler and logs its failure in the OpenCode service before rethrowing it.
 * The client gets only OpenCode's `rpc.internal` error, so the reason shows only here.
 */
async function logRpcFailure<T>(method: string, handler: () => Promise<T>): Promise<T> {
  try {
    return await handler();
  } catch (error) {
    console.warn(`[opencode-quota] ${method} RPC failed: ${logReason(error)}`);
    throw error;
  }
}

export const QuotaToastPlugin = Plugin.define({
  id: "npv12.opencode-quota",
  async setup(ctx) {
    const roots = resolveOpenCodeLocationRoots(ctx.location.directory);
    // The quota collector accepts a small V1-shaped configuration client. V2
    // does not expose a mutable global config to plugins; quota settings are
    // read from the plugin's own config file by the collector.
    const client = {
      config: {
        get: async () => ({ data: {} }),
        providers: async () => ({
          data: {
            providers: (await ctx.provider.list()).data.map((provider) => ({ id: provider.id })),
          },
        }),
      },
    };

    const buildOutput = (
      command: QuotaDialogCommandId,
      sessionID: string | undefined,
      argumentsText: string | undefined,
    ) =>
      buildQuotaDialogCommandOutput({
        command,
        arguments: argumentsText,
        client,
        roots,
        sessionID,
        resolveSessionMeta: async (id) => {
          const session = await ctx.session.get({ sessionID: id });
          return { modelID: session.model?.id, providerID: session.model?.providerID };
        },
      });

    // The TUI reads the session model from its local store, which has nothing for an
    // unknown session. The RPC handlers match that: a failed lookup means no model.
    const resolveSessionMeta = async (id: string): Promise<QuotaSessionModelContext> => {
      try {
        const session = await ctx.session.get({ sessionID: id });
        return { modelID: session.model?.id, providerID: session.model?.providerID };
      } catch {
        return {};
      }
    };
    const surfaceHost: QuotaSurfaceHost = { client, roots, resolveSessionMeta };

    // Awaited so the plugin is active only once the RPC is registered: OpenCode waits for
    // activation before it routes an RPC call, so the first TUI call cannot miss it.
    await ctx.rpc.register(QuotaRpc, {
      surface: (input) =>
        logRpcFailure("surface", async () => ({
          quota: (await getQuotaMessage(surfaceHost, input.sessionID)) ?? null,
        })),
      command: async (input): Promise<QuotaRpcCommandOutput> => {
        try {
          return await buildOutput(input.command, input.sessionID, input.arguments);
        } catch (error) {
          // Return the reason as output so the TUI shows it instead of OpenCode's rpc.internal.
          const spec = QUOTA_DIALOG_COMMANDS.find((item) => item.id === input.command)!;
          const output = sanitizeDisplayText(
            error instanceof Error ? error.message : String(error),
          );
          return {
            state: "output",
            command: input.command,
            title: spec.title,
            output,
            document: messageDocument(output),
            dialogSize: spec.dialogSize,
          };
        }
      },
    });

    // Web, Desktop, and the TUI list this in their "/" menu. In "dialog" mode the TUI runs a
    // typed command itself over the quota RPC, so it never reaches this. When a report does
    // arrive, the TUI follows tuiCommandDisplay: "dialog" opens its dialog and cancels the
    // posted report, "inline" leaves it in the chat. Its command palette runs the same report
    // without posting it.
    await ctx.command.transform((editor) => {
      for (const spec of QUOTA_DIALOG_COMMANDS) {
        editor.add({
          name: spec.slashName,
          description: spec.description,
          async execute(invocation) {
            const result = await buildOutput(
              spec.id,
              invocation.sessionID,
              invocation.prompt.text.trim() || undefined,
            );
            if (result.state === "noop") return;
            // A message admitted while the AI works is delivered into that turn at its next
            // step, and can make the AI take one more step. Wait until the session is idle.
            await ctx.session.wait({ sessionID: invocation.sessionID });
            const metadata: QuotaReportMetadata = {
              command: spec.id,
              title: result.title,
              at: Date.now(),
              document: result.document,
            };
            // The report is posted as the user's message. resume: false admits it without
            // starting a model turn, so it waits in the session inbox, where Web, Desktop,
            // and the TUI show it. "steer" delivers it together with the user's next message;
            // "queue" would later give it a model turn of its own.
            await ctx.session.prompt({
              sessionID: invocation.sessionID,
              text: formatQuotaReportMessage(sanitizeDisplayText(result.output)),
              metadata: { [QUOTA_REPORT_METADATA_KEY]: metadata },
              delivery: "steer",
              resume: false,
            });
          },
        });
      }
    });

    // Keep quota reports out of every model request built from session history:
    // normal turns, compaction summaries, and generate requests.
    for (const hook of ["context", "compaction", "generate"] as const) {
      await ctx.session.hook(hook, (event) => {
        event.messages = withoutQuotaReports(event.messages);
      });
    }
    // OpenCode titles a new session from its first user message, which can be a report.
    // With nothing else to title from, skip the title request and keep the default title.
    await ctx.session.hook("title", (event) => {
      if (!event.messages.some((message) => message.content.some(hasQuotaReportText))) return;
      event.messages = withoutQuotaReports(event.messages);
      const textLeft = event.messages.some((message) =>
        message.content.some((part) => part.type === "text" && part.text.trim() !== ""),
      );
      if (!textLeft) event.result = "";
    });
    // With waitForQuotaReset on, a request that hit a provider limit is retried after the
    // used-up quota window resets. Any failure keeps OpenCode's own retry decision.
    await ctx.session.hook("retry", async (event) => {
      try {
        const delay = await resolveQuotaResetRetryDelayMs(surfaceHost, event);
        if (delay !== undefined) event.decision = { retry: true, delay };
      } catch (error) {
        console.warn(`[opencode-quota] retry hook failed: ${logReason(error)}`);
      }
    });

    // Every login read in this process goes through this location's `ctx.integration`. Bound
    // last, so a setup that fails part way leaves no binding behind. OpenCode routes tools,
    // commands and RPC calls to the plugin only after setup, so no read comes earlier.
    const unbindCredentialSource = bindCredentialSource(
      createIntegrationCredentialSource(ctx.integration),
    );
    // A login added, changed or switched in OpenCode drops cached logins and failed-login
    // entries, so the next read asks OpenCode again. If the subscription fails, cached logins
    // stay until they expire; the log says why. The cleanup's abort ends it silently.
    const credentialEvents = new AbortController();
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: credentialEvents.signal })) {
        if (event.type === "credential.updated" || event.type === "credential.switched") {
          notifyCredentialsChanged();
        }
      }
    })().catch((error) => {
      if (credentialEvents.signal.aborted) return;
      console.warn(`[opencode-quota] credential event subscription stopped: ${logReason(error)}`);
    });

    return () => {
      credentialEvents.abort();
      unbindCredentialSource();
    };
  },
});

export default QuotaToastPlugin;
