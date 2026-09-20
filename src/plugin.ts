import { Plugin } from "@opencode/plugin";

import { findGitWorktreeRoot, getEffectiveConfigRoot } from "./lib/config-file-utils.js";
import { sanitizeDisplayText } from "./lib/display-sanitize.js";
import {
  buildQuotaDialogCommandOutput,
  QUOTA_DIALOG_COMMANDS,
  type QuotaDialogCommandId,
} from "./lib/quota-dialog-commands.js";
import type { SessionModelMeta } from "./lib/quota-render-data.js";

type DialogClient = Parameters<typeof buildQuotaDialogCommandOutput>[0]["client"];

export default Plugin.define({
  id: "@npv12/opencode-quota",
  async setup(context) {
    const client = {
      config: {
        get: async () => ({ data: {} }),
        providers: async () => ({ data: { providers: [] } }),
      },
      session: {
        get: async ({ path }: { path: { id: string } }) => {
          const session = await context.session.get({ sessionID: path.id });
          return {
            data: {
              parentID: session.parentID,
              model: session.model,
            },
          };
        },
      },
    } as DialogClient;

    const roots = () => {
      const workspaceRoot = findGitWorktreeRoot(context.location.directory) ?? context.location.directory;
      return {
        workspaceRoot,
        configRoot: getEffectiveConfigRoot(workspaceRoot),
        fallbackDirectory: context.location.directory,
      };
    };

    const sessionModelMeta = async (sessionID: string): Promise<SessionModelMeta> => {
      try {
        const session = await context.session.get({ sessionID });
        return {
          modelID: session.model?.id,
          providerID: session.model?.providerID,
        };
      } catch {
        return {};
      }
    };

    await context.command.transform((editor) => {
      for (const spec of QUOTA_DIALOG_COMMANDS) {
        editor.add({
          name: spec.slashName,
          description: spec.description,
          execute: async ({ sessionID, prompt }) => {
            const result = await buildQuotaDialogCommandOutput({
              command: spec.id as QuotaDialogCommandId,
              arguments: prompt.text,
              client,
              roots: roots(),
              sessionID,
              resolveSessionMeta: sessionModelMeta,
            });

            if (result.state === "output") {
              await context.session.synthetic({
                sessionID,
                text: sanitizeDisplayText(result.output),
              });
            }
          },
        });
      }
    });
  },
});
