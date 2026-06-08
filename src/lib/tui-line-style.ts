import type { TuiPluginApi } from "@opencode-ai/plugin/tui";

export function getSidebarBodyLineColor(
  _line: string,
  _theme: Pick<TuiPluginApi["theme"]["current"], "text" | "textMuted">,
): TuiPluginApi["theme"]["current"]["textMuted"] {
  return _theme.textMuted;
}
