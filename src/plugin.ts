/**
 * OpenCode V2 server plugin: the /quota slash command for Web and Desktop, and the quota RPC
 * that serves the TUI the snapshot, settings and usage. It reads the server settings
 * (settings.jsonc) and follows every change to them. Inside OpenCode, logins are read only here,
 * through OpenCode's integration API.
 */
import { Plugin } from "@opencode/plugin";
import { snapshotFilePath } from "./core/persist.js";
import {
  customRowPrefix,
  loadProviderSource,
  loadServerSettings,
  type ProviderSourceHost,
} from "./core/provider-source.js";
import { safeErrorText } from "./core/redact.js";
import { createQuotaStore, withTimeout } from "./core/store.js";
import type { QuotaSnapshot, SessionModel } from "./core/types.js";
import {
  sessionUsage,
  type UsageQuery,
  type UsageReport,
  usageReport,
  withProviderNames,
} from "./core/usage.js";
import { findGitWorktreeRoot } from "./lib/config-file-utils.js";
import { sanitizeDisplayText } from "./lib/display-sanitize.js";
import { downloadPrices, refreshPricesIfDue } from "./lib/modelsdev-pricing.js";
import {
  bindCredentialSource,
  createIntegrationCredentialSource,
  notifyCredentialsChanged,
} from "./lib/opencode-auth.js";
import {
  containsQuotaReport,
  formatQuotaReportMessage,
  QUOTA_REPORT_METADATA_KEY,
  type QuotaReportMetadata,
  quotaMessageText,
  removeQuotaReports,
} from "./lib/quota-report-message.js";
import { resolveQuotaResetRetryDelayMs } from "./lib/quota-retry-wait.js";
import { QuotaRpc } from "./rpc.js";
import {
  clientSettings,
  createLiveSettings,
  loadSettings,
  SETTINGS_SCHEMA,
  settingsPath,
} from "./settings/index.js";
import { DEFAULT_QUICK_LOOK_RANGE } from "./view/quick-look.js";

const PROVIDER_NAMES_TIMEOUT_MS = 2_000;

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

/**
 * Runs an RPC handler and logs its failure in the OpenCode service before rethrowing it.
 * The client gets only OpenCode's `rpc.internal` error, so the reason shows only here.
 */
async function logRpcFailure<T>(method: string, handler: () => Promise<T>): Promise<T> {
  try {
    return await handler();
  } catch (error) {
    console.warn(`[opencode-quota] ${method} RPC failed: ${safeErrorText(error)}`);
    throw error;
  }
}

/** The server plugin; `providers` replaces the registered providers (tests pass their own). */
export function createQuotaServerPlugin(
  options: { providers?: ProviderSourceHost["providers"] } = {},
) {
  return Plugin.define({
    id: "npv12.opencode-quota.server",
    async setup(ctx) {
      const locationDirectory = ctx.location.directory;
      const projectDir = findGitWorktreeRoot(locationDirectory) ?? locationDirectory;
      // The providers ask OpenCode which providers it has through this small client.
      const client = {
        config: {
          providers: async () => ({
            data: {
              providers: (await ctx.provider.list()).data.map((provider) => ({ id: provider.id })),
            },
          }),
        },
      };

      // The server holds the settings it read last; every reader takes them from here.
      const liveSettings = await createLiveSettings({ projectDir });

      // The v6 quota store: last known rows, saved in the state dir, refreshed in the background.
      // Building it reads nothing; the first snapshot or refresh call loads the file.
      const sourceHost: ProviderSourceHost = {
        client,
        workspaceRoot: projectDir,
        locationDirectory,
        settings: liveSettings.current,
        providers: options.providers,
      };
      const store = createQuotaStore({
        source: (model) => loadProviderSource(sourceHost, model),
        sessionModel: (sessionID) => sessionModel(sessionID),
        file: snapshotFilePath(),
      });
      // The TUI reads the session model from its local store, which has nothing for an
      // unknown session. The RPC handlers match that: a failed lookup means no model.
      // With a session, a snapshot also names the providers serving its current model.
      const sessionModel = async (sessionID: string | undefined): Promise<SessionModel> => {
        if (!sessionID) return {};
        try {
          const session = await ctx.session.get({ sessionID });
          return { id: session.model?.id, providerID: session.model?.providerID };
        } catch {
          return {};
        }
      };
      const withSessionTokens = async (
        snapshot: QuotaSnapshot,
        sessionID: string | undefined,
      ): Promise<QuotaSnapshot> => {
        if (!sessionID) return snapshot;
        const sessionTokens = await sessionUsage(
          sessionID,
          liveSettings.current().settings.words.sessionTokens,
        );
        return sessionTokens ? { ...snapshot, sessionTokens } : snapshot;
      };
      // Every snapshot a client gets carries the server's words, the OpenCode provider of each
      // custom definition, and the settings, and none of the server-only provider facts.
      const forClients = (snapshot: QuotaSnapshot): QuotaSnapshot => {
        const loaded = liveSettings.current();
        const { settings } = loaded;
        const custom = settings.providers.custom;
        return {
          ...snapshot,
          providers: snapshot.providers.map(
            ({ debug: _serverOnly, exportPart: _alsoServerOnly, ...provider }) => provider,
          ),
          words: settings.words,
          ...(custom.length > 0
            ? {
                customRowProviders: Object.fromEntries(
                  custom.map((one) => [customRowPrefix(one.id), one.providerId]),
                ),
              }
            : {}),
          settings: clientSettings(loaded),
          ...(liveSettings.converted() ? { settingsConverted: true } : {}),
        };
      };

      // The usage report with the configured price list, after a due price download had its
      // chance, and OpenCode's names for its providers, asked for alongside it. When OpenCode's
      // provider list fails or takes longer than PROVIDER_NAMES_TIMEOUT_MS, the report has no
      // names and shows the plugin's labels or the ids.
      const loadUsageReport = async (query: UsageQuery): Promise<UsageReport> => {
        await refreshPricesIfDue();
        const openCodeProviders = withTimeout(
          ctx.provider.list(),
          PROVIDER_NAMES_TIMEOUT_MS,
          `no answer within ${PROVIDER_NAMES_TIMEOUT_MS / 1000}s`,
        ).then(
          ({ data }) => data,
          (error) => {
            console.warn(`[opencode-quota] provider names failed: ${safeErrorText(error)}`);
            return undefined;
          },
        );
        const [report, providers] = await Promise.all([usageReport(query), openCodeProviders]);
        return providers ? withProviderNames(report, providers) : report;
      };

      // Awaited so the plugin is active only once the RPC is registered: OpenCode waits for
      // activation before it routes an RPC call, so the first TUI call cannot miss it.
      const registration = await ctx.rpc.register(QuotaRpc, {
        snapshot: (input) =>
          logRpcFailure("snapshot", async () => {
            const snapshot = await store.snapshot({ sessionID: input.sessionID });
            return { snapshot: forClients(await withSessionTokens(snapshot, input.sessionID)) };
          }),
        refresh: (input) =>
          logRpcFailure("refresh", async () => {
            const options = {
              reason: input.reason,
              providerIds: input.providerIds,
              sessionID: input.sessionID,
            };
            const snapshot = await store.refresh(options);
            return { snapshot: forClients(await withSessionTokens(snapshot, input.sessionID)) };
          }),
        usage: (input) =>
          logRpcFailure("usage", async () => {
            const { range, sessionID, subagents, from, to } = input;
            return { report: await loadUsageReport({ range, sessionID, subagents, from, to }) };
          }),
        downloadPrices: () => logRpcFailure("downloadPrices", downloadPrices),
        // Read now, so a custom provider changed a moment ago shows as it is before a switch-on.
        settings: () =>
          logRpcFailure("settings", async () => clientSettings(await loadSettings({ projectDir }))),
        // Answers once the new settings are in use. `customEnabled` is the user's switch in the
        // quota window; no agent tool calls this.
        saveSettings: (input) =>
          logRpcFailure("saveSettings", async () => {
            const result = await liveSettings.save(input.patch, {
              allowFileOnly: false,
              customEnabled: input.customEnabled,
            });
            return { ok: result.ok, issues: result.issues };
          }),
        // As JSON, which has no undefined default (an unset color's) that OpenCode would refuse.
        settingsSchema: () =>
          logRpcFailure("settingsSchema", async () => ({
            rules: JSON.parse(JSON.stringify(SETTINGS_SCHEMA)),
            path: settingsPath(),
          })),
      });
      const announce = (snapshot: QuotaSnapshot) => {
        void (async () => {
          try {
            await registration.events.emit("changed", { snapshot: forClients(snapshot) });
          } catch (error) {
            console.warn(`[opencode-quota] changed event failed: ${safeErrorText(error)}`);
          }
        })();
      };
      const unsubscribeStore = store.subscribe(announce);

      // New settings (saved here, or settings.jsonc edited by hand, by an agent or by another
      // OpenCode process) can change the providers, who each one is signed in as, the words and
      // the prices. They supersede the store's running work: every client gets a snapshot built
      // from them at once, then the new rows as more `changed` events. A check made with another
      // time limit, interval or price list is out of date, so every provider is checked again.
      const settingsWatch = await liveSettings.follow(async (change) => {
        store.settingsChanged({ recheck: change.recheck });
      });

      // Web and Desktop list this in their "/" menu and get the report as a chat message. The
      // TUI shows /quota in its quota window instead.
      const postReport = async (sessionID: string, command: string, report: string) => {
        // A message admitted while the AI works is delivered into that turn at its next
        // step, and can make the AI take one more step. Wait until the session is idle.
        await ctx.session.wait({ sessionID });
        const metadata: QuotaReportMetadata = { command, at: Date.now() };
        // The report is posted as the user's message. resume: false admits it without
        // starting a model turn, so it waits in the session inbox, where Web and Desktop
        // show it. "steer" delivers it together with the user's next message; "queue"
        // would later give it a model turn of its own.
        await ctx.session.prompt({
          sessionID,
          text: formatQuotaReportMessage(sanitizeDisplayText(report)),
          metadata: { [QUOTA_REPORT_METADATA_KEY]: metadata },
          delivery: "steer",
          resume: false,
        });
      };
      await ctx.command.transform((editor) => {
        editor.add({
          name: "quota",
          description: "Quick look: your quota limits and the last 7 days of usage.",
          async execute(invocation) {
            // /quota waits for the providers that are due a check; the rest show their last rows.
            const snapshot = forClients(
              await store.refresh({ reason: "poll", sessionID: invocation.sessionID }),
            );
            // Without OpenCode's history the limits still show.
            const usage = await loadUsageReport({ range: DEFAULT_QUICK_LOOK_RANGE }).catch(
              (error) => {
                console.warn(`[opencode-quota] /quota usage failed: ${safeErrorText(error)}`);
                return undefined;
              },
            );
            const report = quotaMessageText({ snapshot, usage, nowMs: Date.now() });
            await postReport(invocation.sessionID, "quota", report);
          },
        });
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
          const delay = await resolveQuotaResetRetryDelayMs(
            { store, loadSettings: () => loadServerSettings(sourceHost) },
            event,
          );
          if (delay !== undefined) event.decision = { retry: true, delay };
        } catch (error) {
          console.warn(`[opencode-quota] retry hook failed: ${safeErrorText(error)}`);
        }
      });

      // Every login read in this process goes through this location's `ctx.integration`. Bound
      // last, so a setup that fails part way leaves no binding behind. OpenCode routes tools,
      // commands and RPC calls to the plugin only after setup, so no read comes earlier.
      const unbindCredentialSource = bindCredentialSource(
        createIntegrationCredentialSource(ctx.integration),
      );
      // A login added, changed or switched in OpenCode drops cached logins and failed-login
      // entries, so the next read asks OpenCode again, and makes the store check who each
      // provider is signed in as. If the subscription fails, cached logins stay until they
      // expire; the log says why. Model selections update the session's quota scope too.
      // The cleanup's abort ends the subscription silently. OpenCode before 2.2 ignores `types`
      // and sends every event, so the loop still checks each event's type.
      const credentialEvents = new AbortController();
      void (async () => {
        for await (const event of ctx.event.subscribe({
          types: ["credential.updated", "credential.switched", "session.model.selected"],
          signal: credentialEvents.signal,
        })) {
          if (event.type === "credential.updated" || event.type === "credential.switched") {
            notifyCredentialsChanged();
            store.invalidateIdentity();
          }
          if (event.type === "session.model.selected") {
            store.sessionModelChanged(event.data.sessionID);
          }
        }
      })().catch((error) => {
        if (credentialEvents.signal.aborted) return;
        console.warn(
          `[opencode-quota] credential event subscription stopped: ${safeErrorText(error)}`,
        );
      });

      // Running fetches still read logins and prices, so the store is drained before the
      // bindings go.
      return async () => {
        credentialEvents.abort();
        settingsWatch.close();
        unsubscribeStore();
        await store.dispose();
        unbindCredentialSource();
        liveSettings.dispose();
      };
    },
  });
}

export const QuotaToastPlugin = createQuotaServerPlugin();

export default QuotaToastPlugin;
