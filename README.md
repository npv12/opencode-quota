# OpenCode Quota

Quota visibility in OpenCode: the `/quota` window, the TUI sidebar panel, and a terminal `show` command.

This is a maintained fork of [`@slkiser/opencode-quota`](https://github.com/slkiser/opencode-quota), published as `@npv12/opencode-quota` by [Pranav (npv12)](https://github.com/npv12).

> [!IMPORTANT]
> You need OpenCode `2.0.28+` and Node.js `22.13+` or `23.4+`.

## Quick start

Add OpenCode Quota to `opencode.jsonc` or `opencode.json`, and keep your other plugins. The package also exports `./tui`, which OpenCode loads automatically beside the server plugin:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@npv12/opencode-quota"],
}
```

Restart OpenCode, then type `/quota`. The window opens on Limits; `tab` moves between Limits, Usage and Settings.

## What you get

- **`/quota` window:** your limits, token usage and settings. It covers the chat above the message box and closes with `esc`.
- **Sidebar panel:** an always-visible, headerless list of the limiting window for each provider. Provider names, compact windows (`1h`, `5h`, `7d`, `30d`), one-decimal resets (`2.9h`, `2.9d`) and bare percentages. Percentages keep the theme's level color.
- **Terminal:** `npx @npv12/opencode-quota@latest show` collects live quota and works even with OpenCode closed.
- **Scripts and status bars:** `show --json` prints cached JSON, with an optional threshold probe for CI. See [External integration](docs/readme/external-integration.md).

## Commands

### Slash commands

| Command  | What it shows |
| -------- | ------------- |
| `/quota` | Current quota, usage and settings |

### CLI commands

| Command                                 | What it does |
| --------------------------------------- | ------------ |
| `npx @npv12/opencode-quota@latest show` | Show current quota as text or JSON |

`show` collects live quota in your terminal and works with OpenCode closed. Add `--json` for machine output that reads the cache instead, and `--threshold <pct>` (with `--json`) to exit non-zero when comparable cached quota is below the threshold. Add `--help` to see all options.

## Settings

Change settings in the `/quota` window's Settings tabs, or edit `opencode-quota/settings.jsonc` in OpenCode's config folder. The window keeps your comments when it saves.

## Providers

Log in with `/connect` and the provider shows up.

<table>
<tr>
<td valign="top">

| American | Plans |
| --- | --- |
| [Anthropic (Claude)](docs/readme/providers.md#anthropic-claude)\* | Personal · Business |
| [Cursor](docs/readme/providers.md#cursor)\* | Personal · Business |
| [Gemini CLI](docs/readme/providers.md#gemini-cli)\* | Business |
| GitHub Copilot | Personal · [Business](docs/readme/providers.md#github-copilot)\* |
| [Google AGY](docs/readme/providers.md#google-agy-quick-setup)\* | Personal · Business |
| Ollama Cloud | Personal |
| OpenAI | Personal · Business |
| OpenCode Go | Personal |
| OpenCode Zen | Personal · Business |
| OpenRouter | Personal · Business |
| xAI | Personal · Business |

</td>
<td valign="top">

| Chinese | Plans |
| --- | --- |
| [Alibaba Coding Plan](docs/readme/providers.md#alibaba-coding-plan)\* | Personal |
| [Alibaba Token Plan](docs/readme/providers.md#alibaba-token-plan)\* | Personal · Business |
| DeepSeek | Personal |
| Kimi Code | Personal · Business |
| Kimi Code (CN) | Personal · Business |
| MiniMax Token Plan | Personal · Business |
| MiniMax Token Plan (CN) | Personal · Business |
| [Xiaomi MiMo](docs/readme/providers.md#xiaomi-mimo)\* | Personal |
| Z.ai Coding Plan | Personal |
| Zhipu Coding Plan | Personal · Business |

</td>
</tr>
</table>

\* Linked names need one more step; the rest work once you log in. [What each one reports](docs/readme/providers.md#pre-configured-providers).

- OpenAI ChatGPT needs a Codex login ([how](docs/readme/providers.md#openai-and-xai)).
- Gemini CLI works only with Gemini Code Assist Standard or Enterprise (organization) accounts. Personal Google accounts use Google AGY.
- Business plans of the Chinese providers show only your own API key's usage (Alibaba Token Plan: one Credits row per seat).
- API keys come from OpenCode or an [environment variable](docs/readme/providers.md#api-keys).

### Custom providers

Track any other provider, from its quota API or from a local estimate. Add a custom provider in `settings.jsonc` under `providers.custom`; it is saved switched off, and you switch it on in the window's Settings → Providers. [Copy-paste examples](docs/readme/providers.md#custom-providers).

## Reference

Guides: [Configuration](docs/readme/configuration.md) · [Providers](docs/readme/providers.md) · [Troubleshooting](docs/readme/troubleshooting.md) · [External integration](docs/readme/external-integration.md) · [Updating](docs/readme/updating.md)

Outside links: [OpenCode docs](https://opencode.ai/docs/) · [OpenCode config](https://opencode.ai/docs/config/) · [OpenCode plugins](https://opencode.ai/docs/plugins/) · [OpenCode TUI](https://opencode.ai/docs/tui/) · [models.dev pricing data](https://models.dev/) · [Node.js downloads](https://nodejs.org/en/download)

## License

MIT
