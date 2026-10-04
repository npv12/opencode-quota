/**
 * Ids, titles and dialog sizes of the quota commands. They live apart from the report
 * builders in quota-dialog-commands.ts so code that only lists or names the commands
 * does not load the quota report code.
 */
import type { ReportDocument } from "./report-document.js";

export type QuotaDialogCommandId = "quota";

export type QuotaDialogCommandSpec = {
  id: QuotaDialogCommandId;
  slashName: string;
  title: string;
  description: string;
  dialogSize: "medium" | "large" | "xlarge";
};

export type QuotaDialogCommandOutputResult =
  | {
      state: "output";
      command: QuotaDialogCommandId;
      title: string;
      /** The report as text, for the chat and the CLI. */
      output: string;
      /** The same report, structured; the TUI dialog renders it. */
      document: ReportDocument;
      dialogSize: "medium" | "large" | "xlarge";
    }
  | {
      state: "noop";
      command: QuotaDialogCommandId;
      reason: "disabled";
    };

export const QUOTA_DIALOG_COMMANDS: readonly QuotaDialogCommandSpec[] = [
  {
    id: "quota",
    slashName: "quota",
    title: "OpenCode Quota",
    description: "Show deterministic quota output.",
    dialogSize: "xlarge",
  },
] as const;

export const QUOTA_DIALOG_COMMANDS_BY_ID: ReadonlyMap<
  QuotaDialogCommandId,
  QuotaDialogCommandSpec
> = (() => {
  const map = new Map<QuotaDialogCommandId, QuotaDialogCommandSpec>();
  for (const spec of QUOTA_DIALOG_COMMANDS) {
    map.set(spec.id, spec);
  }
  return map;
})();

export function isQuotaDialogCommand(command: string): command is QuotaDialogCommandId {
  return QUOTA_DIALOG_COMMANDS_BY_ID.has(command as QuotaDialogCommandId);
}

/**
 * Reads prompt text as a typed quota slash command. As in OpenCode, the command name ends
 * at the first whitespace; like the server command, the rest is trimmed into its arguments.
 * Returns undefined when the text is not exactly one of the quota commands.
 */
export function parseQuotaSlashCommand(
  text: string,
): { command: QuotaDialogCommandId; argumentsText: string | undefined } | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const name = trimmed.slice(1).split(/\s/, 1)[0];
  const spec = QUOTA_DIALOG_COMMANDS.find((item) => item.slashName === name);
  if (!spec) return undefined;
  return { command: spec.id, argumentsText: trimmed.slice(1 + name.length).trim() || undefined };
}
