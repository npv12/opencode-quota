# OpenCode Quota

Quota visibility in OpenCode: the `/quota` command, the TUI sidebar panel, and a terminal `show` command.

This is a maintained fork of [`@slkiser/opencode-quota`](https://github.com/slkiser/opencode-quota), published as `@npv12/opencode-quota` by [Pranav (npv12)](https://github.com/npv12).

> [!IMPORTANT]
> You need OpenCode `2.0.16+` and Node.js `22.13+` or `23.4+`.

## Quick start

Add OpenCode Quota to `opencode.jsonc` or `opencode.json`, and keep your other plugins. The package also exports `./tui`, which OpenCode loads automatically beside the server plugin:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@npv12/opencode-quota"],
}
```

Restart OpenCode, then type `/quota`. See [Manual install](docs/readme/manual-install.md) for the settings file and alternatives.

## What you get

- **Sidebar panel:** always-visible, muted, headerless `Quota` rows with simple provider names, optional compact windows (`1h`, `5h`, `7d`, `30d`), one-decimal resets (`2.9h`, `2.9d`), and bare percentages. Non-time labels and unavailable countdowns are omitted. It keeps the lowest remaining window for each provider/source and keeps value rows. OpenCode Zen rows and errors are hidden from the sidebar.
- **`/quota` command:** shows current quota as a popup dialog, or in the chat when `tuiCommandDisplay` is `inline`.
- **Terminal:** `npx @npv12/opencode-quota@latest show` collects live quota and works even with OpenCode closed.
- **Scripts and status bars:** `show --json` prints cached JSON, with an optional threshold probe for CI. See [External integration](docs/readme/external-integration.md).
- **Retry at the reset:** when a request hits a limit and that provider's quota shows a used-up window, OpenCode retries after it resets. Turn off with `waitForQuotaReset: false`.

## Commands

### Slash commands

| Command  | What it shows |
| -------- | ------------- |
| `/quota` | Current quota |

### CLI commands

| Command                                 | What it does |
| --------------------------------------- | ------------ |
| `npx @npv12/opencode-quota@latest show` | Show current quota as text or JSON |

`show` collects live quota in your terminal and works with OpenCode closed. Add `--json` for machine output that reads the cache instead, and `--threshold <pct>` (with `--json`) to exit non-zero when comparable cached quota is below the threshold. Add `--help` to see all options.

## Providers

Most providers work automatically once you log in through OpenCode. **Needs setup** links show the extra step.

### Pre-configured American providers

<details open>
<summary><strong>Personal</strong></summary>

| Provider           | Auth/setup                                                     | Data from          | Reports            |
| ------------------ | -------------------------------------------------------------- | ------------------ | ------------------ |
| Anthropic (Claude) | [Needs setup](docs/readme/providers.md#anthropic-claude)       | Local CLI/OAuth    | Quota              |
| Chutes AI          | Automatic                                                      | Remote API         | Quota              |
| Cursor             | [Needs setup](docs/readme/providers.md#cursor)                 | Local estimate     | Budget and spend   |
| GitHub Copilot     | Automatic                                                      | Remote API         | Budget and usage   |
| Google AGY         | [Needs setup](docs/readme/providers.md#google-agy-quick-setup) | Remote API         | Quota              |
| Kilo Gateway       | Automatic                                                      | Remote API         | Quota and balance  |
| NanoGPT            | Automatic                                                      | Remote API         | Quota and balance  |
| Ollama Cloud       | Automatic                                                      | Remote API         | Quota and usage    |
| OpenAI             | Automatic                                                      | Remote API         | Quota              |
| OpenCode Go        | Automatic                                                      | Remote API         | Quota              |
| OpenCode Zen       | Automatic                                                      | Remote API         | Budget and balance |
| OpenRouter         | Automatic                                                      | Remote API         | Budget and spend   |
| Synthetic          | Automatic                                                      | Remote API         | Quota              |
| xAI SuperGrok      | Automatic                                                      | Remote API         | Quota              |

</details>

<details>
<summary><strong>Business / Enterprise</strong></summary>

| Provider                | Auth/setup                                                     | Data from          | Reports            |
| ----------------------- | -------------------------------------------------------------- | ------------------ | ------------------ |
| Anthropic (Claude)      | [Needs setup](docs/readme/providers.md#anthropic-claude)       | Local CLI/OAuth    | Quota              |
| Chutes AI               | Automatic                                                      | Remote API         | Quota              |
| Cursor                  | [Needs setup](docs/readme/providers.md#cursor)                 | Local estimate     | Budget and spend   |
| Gemini CLI              | [Needs setup](docs/readme/providers.md#gemini-cli)             | Remote API         | Quota              |
| GitHub Copilot          | [Needs setup](docs/readme/providers.md#github-copilot)         | Remote API         | Budget and usage   |
| Google AGY              | [Needs setup](docs/readme/providers.md#google-agy-quick-setup) | Remote API         | Quota              |
| NanoGPT                 | Automatic                                                      | Remote API         | Quota and balance  |
| OpenAI                  | Automatic                                                      | Remote API         | Quota              |
| OpenCode Zen            | Automatic                                                      | Remote API         | Budget and balance |
| OpenRouter              | Automatic                                                      | Remote API         | Budget and spend   |
| Synthetic               | Automatic                                                      | Remote API         | Quota              |
| xAI SuperGrok           | Automatic                                                      | Remote API         | Quota              |

Gemini CLI works only with Gemini Code Assist Standard or Enterprise (organization) accounts. Personal Google users should use Google AGY.

</details>

### Pre-configured Chinese providers

<details open>
<summary><strong>Personal</strong></summary>

| Provider                      | Auth/setup                                                                   | Data from      | Reports            |
| ----------------------------- | ---------------------------------------------------------------------------- | -------------- | ------------------ |
| Alibaba Coding Plan           | Automatic                                                                    | Local estimate | Quota              |
| Alibaba Personal Token Plan   | [Needs setup](docs/readme/providers.md#alibaba-personal-token-plan)          | Official CLI   | Quota              |
| DeepSeek                      | Automatic                                                                    | Remote API     | Balance and status |
| Kimi Code                     | Automatic                                                                    | Remote API     | Quota              |
| Kimi Code (CN)                | Automatic                                                                    | Remote API     | Quota              |
| MiniMax Token Plan            | Automatic                                                                    | Remote API     | Quota              |
| MiniMax Token Plan (CN)       | Automatic                                                                    | Remote API     | Quota              |
| Xiaomi MiMo                   | [Needs setup](docs/readme/providers.md#xiaomi-mimo)                          | Dashboard API  | Quota and balance  |
| Z.ai Coding Plan              | Automatic                                                                    | Remote API     | Quota              |
| Zhipu Coding Plan             | Automatic                                                                    | Remote API     | Quota              |

</details>

<details>
<summary><strong>Business / Team</strong></summary>

| Provider                 | Auth/setup | Data from  | Reports |
| ------------------------ | ---------- | ---------- | ------- |
| Kimi Code                | Automatic  | Remote API | Quota   |
| Kimi Code (CN)           | Automatic  | Remote API | Quota   |
| MiniMax Token Plan       | Automatic  | Remote API | Quota   |
| MiniMax Token Plan (CN)  | Automatic  | Remote API | Quota   |
| Zhipu Coding Plan        | Automatic  | Remote API | Quota   |

These show only your own member API key's usage, not the whole organization's.

</details>

### Custom providers

Track a provider that is not listed, from its quota API or from a local estimate, with a global `quotaProviders` definition in your OpenCode Quota settings file. See the [custom-provider guide](docs/readme/providers.md#custom-providers).

## Troubleshooting

1. Provider missing? Log in to it again in OpenCode 2.
2. Using a companion plugin (Cursor, Google)? List it **before** `@npv12/opencode-quota` in `opencode.json`.
3. `claude` or `bl` not found? See [Service environment](docs/readme/troubleshooting.md#service-environment).
4. `show --json` empty? It reads cached data only, so trigger a normal refresh first, or run `show` for a live check.

More fixes: [Troubleshooting](docs/readme/troubleshooting.md).

## Reference

Guides: [Manual install](docs/readme/manual-install.md) · [Configuration](docs/readme/configuration.md) · [Providers](docs/readme/providers.md) · [Troubleshooting](docs/readme/troubleshooting.md) · [External integration](docs/readme/external-integration.md)

Outside links: [OpenCode docs](https://opencode.ai/v2/docs) · [OpenCode config](https://opencode.ai/v2/docs/config) · [OpenCode plugins](https://opencode.ai/v2/docs/build/plugins) · [OpenCode CLI plugins](https://opencode.ai/v2/docs/build/plugins/cli) · [models.dev pricing data](https://models.dev/) · [Node.js downloads](https://nodejs.org/en/download)

## License

MIT. OpenCode Quota is not built by the OpenCode team and is not affiliated with OpenCode or any provider listed above.

This fork tracks the upstream project at https://github.com/slkiser/opencode-quota.
