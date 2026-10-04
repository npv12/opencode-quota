[← Back to README](../../README.md)

# Manual install

Edit the OpenCode files yourself. This fork ships no guided installer.

## Requirements

- OpenCode `2.0.16` or newer.
- Node.js `22.13+` is required for `npx @npv12/opencode-quota ...` (on Node 23, `23.4+`).

## Choose where to install

- **Global:** works in every project. Files live in `~/.config/opencode` on every OS (`$XDG_CONFIG_HOME/opencode` when `XDG_CONFIG_HOME` is set).
- **Project:** works only in the current repo or worktree.
- **Custom:** if `OPENCODE_CONFIG_DIR` is set, OpenCode uses that folder instead of the global one.

Use `.jsonc` files if you want comments, or `.json` if another tool needs strict JSON (no comments, no trailing commas).

## 1. Add the plugin

Add OpenCode Quota to `opencode.jsonc` or `opencode.json`, and keep your other plugins. The package exports both a server plugin and a `./tui` CLI plugin, and OpenCode loads the `./tui` export automatically beside the server plugin:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@npv12/opencode-quota"],
}
```

A package that ships only a CLI plugin is listed in `cli.json` instead; `@npv12/opencode-quota` is not CLI-only.

## 2. Add quota settings

Create `opencode-quota/quota-toast.jsonc` next to that OpenCode config:

```jsonc
{
  // Find providers from your OpenCode config and logins.
  "enabledProviders": "auto",

  // Show the Quota panel in the TUI sidebar.
  "tuiSidebarPanel": { "enabled": true },

  // Keep slash reports in the chat instead of a popup.
  "tuiCommandDisplay": "inline",
}
```

Restart OpenCode, then run `/quota` in the TUI.

## TUI notes

- **TUI:** `/quota` opens the report in a popup and leaves no chat message (default `tuiCommandDisplay: "dialog"`). Set `"inline"` to keep it in the chat.
- **Web and Desktop:** `/quota` posts the report in the chat as your message. The AI never answers it, and the plugin filters it out of every AI request. If you uninstall the plugin, old reports in past chats are no longer filtered.
- Each report starts with `[OpenCode Quota report]` and ends with `[End of OpenCode Quota report]`, which also keeps it out of compaction summaries.
- Web uses a proportional font, so columns may not line up. Use the TUI or `npx @npv12/opencode-quota show` for aligned columns.
- If the AI is busy, the report appears after it finishes. A new session whose first message is a report keeps its default title.

See [Configuration](configuration.md) for every setting.
