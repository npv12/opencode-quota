import type { TuiPluginApi } from "@opencode/plugin/tui";

import { SESSION_TOKEN_SECTION_HEADING } from "./session-tokens-format.js";

export function getSidebarBodyLineColor(
  line: string,
  theme: Pick<TuiPluginApi["theme"]["current"], "text" | "muted">,
): TuiPluginApi["theme"]["current"]["text"] | TuiPluginApi["theme"]["current"]["muted"] {
  return line.length > 0 && SESSION_TOKEN_SECTION_HEADING.startsWith(line)
    ? theme.text
    : theme.muted;
}
