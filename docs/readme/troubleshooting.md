[← Back to README](../../README.md)

# Troubleshooting

## First checks

1. Check that `@npv12/opencode-quota` is in the `plugins` list of `opencode.jsonc` or `.json`. The package's `./tui` export loads automatically beside the server plugin.
2. Restart OpenCode after changing config or logins.
3. Run `npx @npv12/opencode-quota show` in a terminal for a live check, or `show --json` for the cached snapshot.

## Logins

OpenCode Quota never reads `auth.json`. Inside OpenCode, it asks OpenCode 2 for logins (OpenCode keeps them in `opencode.db`). OpenCode 2 copies `auth.json` only once, the first time it starts. **If a provider is missing, log in to it again in OpenCode 2.**

`OPENCODE_DB` and `XDG_DATA_HOME` change the `opencode.db` path used for session and token history. Custom or source builds of OpenCode may use `opencode-<channel>.db`; set `OPENCODE_DB` to that file's path.

## Service environment

The TUI, Web, and Desktop get their numbers from OpenCode's background service. The service takes `PATH` and environment variables from whatever started it first, not from the terminal you use now, and it runs in your home folder. The terminal command uses your terminal's `PATH`, environment, and current folder instead.

- **`claude` or `bl` not found, or an API-key variable ignored:** in a terminal where they work, run `opencode service restart`. To keep that `PATH` for every later start, run `opencode service set env PATH "$PATH"` (it stops the service; open OpenCode again). For Claude you can instead set `anthropicBinaryPath`.
- Cursor's plugin-entry check reads `opencode.json` in your global config folder and your home folder, not in the project folder.

## Terminal commands

`opencode-quota show` runs in your terminal, not in OpenCode:

- `show` collects live quota; `show --json` reads the cached snapshot instead. Both work with OpenCode closed and read logins from `opencode.db` read-only.
- It never refreshes a token, so a sign-in can show as expired (for example `Token expired`) until you open OpenCode.
- It uses your shell's `PATH` and API-key variables.
- It uses the settings of the folder you run them in, so a project's `opencode-quota/quota-toast.jsonc` applies.

## Common problems

| Problem                                                     | Try this                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Slash commands are missing                                  | Check the plugin entry above, then restart OpenCode.                                           |
| `/quota` shows no providers                                 | Check that the provider is logged in, and its [setup notes](providers.md#provider-setup-notes). |
| Sidebar `Quota` panel shows no data                         | Check `tuiSidebarPanel.enabled` (default `true`) and provider logins.                          |
| Web report columns do not line up                           | Expected: Web uses a proportional font. Use the TUI or `npx @npv12/opencode-quota show`.       |
| Terminal shows a sign-in as expired but OpenCode shows data | The terminal never refreshes tokens. Open OpenCode (or use that provider in it) once, then retry. |
| `show --json` looks stale                                   | It is cache-only. Trigger a normal TUI refresh first.                                          |

## Provider fixes

Run `npx @npv12/opencode-quota show --json` first and check that provider's section. Setup steps and API-key variable names are in [Providers](providers.md).

<details>
<summary><strong>Custom providers</strong></summary>

| Symptom                                    | Fix |
| ------------------------------------------ | --- |
| Config is rejected                         | Keep `quotaProviders` in global OpenCode JSONC/JSON. Remove unknown fields, duplicate IDs/request identities, or overlapping model coverage. |
| Definition is `unavailable`                | Confirm OpenCode reports the exact `providerId`. With `onlyCurrentModel`, the model id (without provider prefix) must match `modelIds`, or omit `modelIds`. |
| `missing_credential`                       | Set the `apiKeyEnv` variable, trusted global `provider.<providerId>.options.apiKey`, or an API-key login saved in OpenCode 2 for that provider id. |
| `http_error`, `timeout`, or response error | Check the endpoint and its response format. |
| One definition fails but others show       | Expected. Working definitions stay visible; the failed one stays an error row. |
| Fewer rows than expected                   | Terminal `show` keeps one window per provider with `formatStyle: "singleWindow"` (the default); the sidebar always keeps the lowest remaining percentage per provider/source. Use `"allWindows"` for every terminal row. |
| `show --json` looks stale                  | It is cache-only. Trigger a normal TUI refresh first. |

</details>

<details>
<summary><strong>Anthropic (Claude)</strong></summary>

| Symptom                              | Fix |
| ------------------------------------ | --- |
| `claude` not found                   | Install Claude Code. OpenCode Quota tries `claude` on the [service `PATH`](#service-environment), then `~/.claude/local/claude`, `~/.local/bin/claude`, `/opt/homebrew/bin/claude`, and `/usr/local/bin/claude` (not on Windows). |
| Claude is installed at a custom path | Set `anthropicBinaryPath` in `opencode-quota/quota-toast.json`. |
| Not signed in                        | Run `claude auth login`, then check `claude auth status`. |
| Signed in but no quota rows          | Sign in to Claude again if the OAuth credential fallback is missing or stale. |
| Provider not detected                | Make sure OpenCode uses the `anthropic` provider. |

</details>

<details>
<summary><strong>GitHub Copilot</strong></summary>

| Symptom                                           | Fix |
| ------------------------------------------------- | --- |
| Copilot works in OpenCode but no personal quota   | Log in to Copilot again if the token or its saved GHE.com host is invalid. |
| Organization or enterprise accounting is missing  | Create `copilot-quota-token.json` as in [GitHub Copilot setup](providers.md#github-copilot). |
| GHE.com host is rejected                          | Use the enterprise hostname (for example `acme.ghe.com`) or a host-only HTTPS URL. No `api.`, path, query, fragment, port, userinfo, wildcard, HTTP, IP/localhost, or other domain. |
| Personal report is forbidden                      | Use a fine-grained PAT with **Plan: read** or a GitHub App user token. An installation token cannot read a personal report. |
| Organization report or budget is forbidden        | Use an organization admin/billing-manager credential. Fine-grained PATs and GitHub App tokens need **Organization administration: read**. Usage can still show with a budget warning when only budget access fails. |
| Enterprise report is forbidden                    | Use a classic PAT held by an enterprise admin or billing manager. |
| Usage shows without a percentage                  | Expected when GitHub gives usage but no allowance or budget. OpenCode Quota never invents a percentage. |
| Legacy PRU config is rejected                     | Use `"billingModel": "legacy_premium_requests"` only for an annual Pro or Pro+ plan that stayed on legacy billing after June 1, 2026. |
| Rate-limit error                                  | Wait for GitHub's API rate limit to reset, then run `/quota` again. |

</details>

<details>
<summary><strong>OpenAI and xAI</strong></summary>

| Symptom                                  | Fix |
| ---------------------------------------- | --- |
| OpenAI quota missing                     | Run `opencode auth login openai`. |
| `OpenAI sign-in could not be refreshed`  | OpenCode could not refresh the token. Run `opencode auth login openai`. For xAI (`xAI sign-in could not be refreshed`), run `opencode auth login xai`. |
| Provider not detected                    | Make sure OpenCode uses the `openai` provider or a compatible OpenAI login. |

</details>

<details>
<summary><strong>Cursor</strong></summary>

| Symptom                                   | Fix |
| ----------------------------------------- | --- |
| Cursor not detected                       | Put `cursor-opencode-provider/plugin/opencode2` before `@npv12/opencode-quota` in `opencode.json`. |
| Cursor login missing                      | Run `/connect` → **Cursor** in OpenCode, or set `CURSOR_API_KEY`. |
| Quota shows but no remaining percentage   | Set `cursorPlan` or `cursorIncludedApiUsd`. |
| Billing cycle looks wrong                 | Set `cursorBillingCycleStartDay` to your billing day. |
| Unknown Cursor pricing                    | Cursor `auto`, `composer*`, and `grok-4.5`–`grok-4.7` use bundled Cursor pricing. Other unknown model ids stay unknown rather than guessing. |

</details>

<details>
<summary><strong>Alibaba Coding Plan</strong></summary>

| Symptom              | Fix |
| -------------------- | --- |
| API key not detected | See [API keys](providers.md#api-keys). Repo-local provider secrets are ignored. |
| Limits need tuning   | Add a global local-estimate `quotaProviders` entry with the `alibaba-coding-plan` id and its five-hour, weekly, and monthly rolling windows. |
| Counters do not move | Make sure the current model is `alibaba/*` or `alibaba-cn/*`. |
| Quota seems stale    | Check the state-file path under `~/.local/state/opencode/opencode-quota/quota-providers/`. |

</details>

<details>
<summary><strong>Alibaba Personal Token Plan</strong></summary>

Check the `alibaba_token_plan` rows (separate from Alibaba Coding Plan).

| Symptom                 | Fix |
| ----------------------- | --- |
| CLI not detected        | Install `bailian-cli` so `bl` is in an absolute folder on the [service `PATH`](#service-environment), outside the project folder (for example `/opt/homebrew/bin`, `~/.local/bin`, or an nvm folder). On Windows, use WSL. See [setup](providers.md#alibaba-personal-token-plan). |
| Console session expired | Run `bl auth login --console`. A Coding Plan API key cannot sign in to this provider. |
| Weekly row only         | The official CLI may leave out the five-hour window. OpenCode Quota does not invent it. |
| JSON output empty       | `show --json` is cache-only, and this provider is not cached, so a separate CLI process reports it unavailable instead of running `bl`. |

</details>

<details>
<summary><strong>API-key providers (MiniMax, Kimi, Chutes AI, Synthetic, Z.ai, Zhipu, NanoGPT, DeepSeek, OpenRouter)</strong></summary>

- Put keys in environment variables or trusted user/global config, never in the project's `opencode.json`. Variable names and rules: [API keys](providers.md#api-keys).
- Kimi keys go only to their own region's host: see [Kimi Code](providers.md#kimi-code).
- Synthetic says `Synthetic returned no quota data for this account.`: the quota endpoint returned HTTP 200 `{}`. This is not a bad API key or a Clerk/browser problem, and no 5h or Weekly rows are invented.

</details>

<details>
<summary><strong>Google AGY</strong></summary>

| Symptom                             | Fix |
| ----------------------------------- | --- |
| Companion missing                   | Put `@anthonyhaussman/opencode-agy-auth` before `@npv12/opencode-quota` in `opencode.json`. |
| Provider not enabled in manual mode | Include `google-agy` in `enabledProviders`. |
| Login missing                       | Run `opencode auth login google-agy`. |
| Project missing                     | Set `OPENCODE_AGY_PROJECT_ID` or `provider.google-agy.options.projectId`. |
| No rows                             | Check that the companion plugin is listed before this one and restart OpenCode. |

</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

Gemini CLI works only with Gemini Code Assist Standard or Enterprise (organization) accounts. Google ended personal accounts on 2026-06-18, so personal Google users should use [Google AGY](providers.md#google-agy-quick-setup) instead.

| Symptom                             | Fix |
| ----------------------------------- | --- |
| Companion missing                   | Put `opencode-gemini-auth` before `@npv12/opencode-quota` in `opencode.json`. |
| Provider not enabled in manual mode | Include `google-gemini-cli` in `enabledProviders`. |
| Login missing                       | Run `opencode auth login google`. |
| Project missing                     | Set `provider.google.options.projectId`, `OPENCODE_GEMINI_PROJECT_ID`, `GOOGLE_CLOUD_PROJECT`, or `GOOGLE_CLOUD_PROJECT_ID`. |

</details>

<details>
<summary><strong>Xiaomi MiMo</strong></summary>

| Symptom                             | Fix |
| ----------------------------------- | --- |
| Config not detected                 | Set `MIMO_USAGE_COOKIE` or create trusted user/global `opencode-quota/mimo.json`. |
| Config is invalid                   | Fix or remove the reported higher-priority source; an invalid source blocks fallback on purpose. |
| Provider not enabled in manual mode | Include `xiaomi` in `enabledProviders`. |
| Monthly quota missing               | Make sure the plan is active; expired plans are hidden. |
| Balance or plan details missing     | The requests fail independently, so other rows can still show. |
| Session expired                     | Sign in again at `platform.xiaomimimo.com`, copy a fresh Cookie header ([how](providers.md#xiaomi-mimo)), and update the same source. |

</details>

<details>
<summary><strong>OpenCode Go</strong></summary>

| Symptom                           | Fix |
| --------------------------------- | --- |
| Provider not detected             | Run `opencode auth login opencode`, or set an API key ([order](providers.md#opencode-go)). |
| `auth_state` is `invalid`         | Run `opencode auth login opencode-go`. A broken `opencode-go` login blocks the legacy `opencode` fallback. |
| `OpenCode Console sign-in failed` | Shown only when no API key is set. Run `opencode auth login opencode`, or set an API key. |
| No Go quota                       | The Console request failed and no API key is set. Retry, or set an API key. |
| API returns 401 or 403            | The usage API rejected the key. Update the source, wait briefly for the credential cache to expire, and retry. |
| Invalid API response              | 5h, Weekly, and Monthly must all be valid; one bad window rejects the whole response. |
| Request times out or fails        | Make sure `https://opencode.ai/zen/go/v1/usage` is reachable, and retry. Raise `requestTimeoutMs` only for timeouts. |
| Expected window is not shown      | Update `opencodeGoWindows` (`rolling`, `weekly`, `monthly`). |
| Provider missing in manual mode   | Include `opencode-go` in `enabledProviders`. |

</details>

<details>
<summary><strong>OpenCode Zen</strong></summary>

Zen uses your OpenCode Console sign-in. `opencodeMonthlyLimit` overrides the budget.

| Symptom                                                           | Fix |
| ----------------------------------------------------------------- | --- |
| Zen does not appear                                               | Run `opencode auth login opencode` and sign in to the Console. An API key alone is not a Console sign-in. To see a hint instead of nothing, include `opencode` in `enabledProviders`. |
| `OpenCode Console sign-in failed` or `session expired or invalid` | Run `opencode auth login opencode` again. |
| Wrong organization                                                | Run `opencode auth switch opencode`, or sign in again and pick the organization. |
| `OpenCode Console <route> error 403`                              | Your sign-in cannot read that route for this organization. Zen still shows the other rows, unless the route is `billing/status` (the balance). |

</details>
