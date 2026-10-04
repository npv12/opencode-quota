[← Back to README](../../README.md)

# Configuration

Most people only need the table below. Every option is listed at the bottom.

## Where settings live

Settings go in one separate file:

- Project install: `<your-repo>/opencode-quota/quota-toast.jsonc`
- Global install: `~/.config/opencode/opencode-quota/quota-toast.jsonc` on every OS (`$XDG_CONFIG_HOME/opencode/...` when `XDG_CONFIG_HOME` is set)
- Custom config folder: `$OPENCODE_CONFIG_DIR/opencode-quota/quota-toast.jsonc` (replaces the global folder, like OpenCode 2)

Strict `.json` files also work. Restart OpenCode after changing the file.

## Common changes

| You want                                | Setting                                     |
| --------------------------------------- | ------------------------------------------- |
| Find providers automatically            | `enabledProviders: "auto"`                  |
| Pick providers yourself                 | `enabledProviders: ["copilot", "openai"]`   |
| Show every reset period in terminal `show` | `formatStyle: "allWindows"`               |
| Show one quota window per provider in terminal `show` | `formatStyle: "singleWindow"`   |
| Show quota used instead of left         | `percentDisplayMode: "used"`                |
| Estimate when fixed quota runs out      | `quotaProjection: "runway"`                 |
| Show `81%` instead of `81% left`        | `percentLabelStyle: "bare"`                 |
| Show `2d5h14m` instead of `2d 5h 14m`   | `resetTimeSpaced: false`                    |
| Show reset countdowns as decimals (`5.7d`) | `resetTimeDecimals: 1`                   |
| Show extra accounting rows              | `accountingDetail: "detailed"`              |
| Keep TUI slash reports in the chat      | `tuiCommandDisplay: "inline"`               |
| Populate or hide sidebar data          | `tuiSidebarPanel.enabled`                   |
| Show or hide session input/output tokens | `showSessionTokens`                        |
| Include subagent session tokens         | `sessionTokenScope: "tree"`                 |
| Allow more time for provider requests   | `requestTimeoutMs: 12000`                   |
| Keep OpenCode's normal retry after a limit | `waitForQuotaReset: false`                 |

`formatStyle` applies to the terminal `show` text only. `/quota` and the sidebar always collect every window; the sidebar then keeps the lowest remaining percentage for each provider/source. If `formatStyle` is missing, the default is `singleWindow`.

Example:

```jsonc
{
  "enabledProviders": ["copilot", "openai", "google-agy"],
  "formatStyle": "allWindows",
  "percentDisplayMode": "remaining",
  "quotaProjection": "runway",
  "tuiCommandDisplay": "inline",
  "tuiSidebarPanel": { "enabled": true },
}
```

### Show accounting detail

`accountingDetail` has two values:

- `"summary"` (default): main rows only, with at most one supporting detail per percentage row.
- `"detailed"`: also shows supplementary rows and, on wide output, separate `Used`, `Limit`, and `Remaining` values.

It controls supplementary rows on `/quota`, the terminal `show`, and the sidebar; the sidebar keeps compact provider/time/value rows without non-time labels or separate accounting columns. Narrow reports may drop detail rather than cut off a money value. It is separate from `formatStyle` (which windows) and `percentDisplayMode` (used or left). `Used`, `Limit`, and `Remaining` always mean exactly that, in either mode. A change applies right away to data already fetched.

### Estimate when fixed quota runs out

`quotaProjection: "runway"` (off by default) adds a **Runs out** estimate to eligible rows on `/quota` and the terminal `show`.

- It is a straight-line average since the fixed window began: used percentage divided by time passed. It is not a recent-rate forecast. `percentDisplayMode` does not change it.
- Full displays say **Runs out ≈ 1h 50m**. Partial minutes round up. If your current pace lasts past the reset, it says **lasts past reset**. The reset countdown stays separate.
- It uses cached data, makes no extra provider requests, and adds nothing to the JSON output.

Only rows with a known fixed window start, end, and full reset qualify. Labels such as Five-hour, Weekly, Monthly, or RPM never qualify a row by themselves:

- **OpenAI:** known 5-hour, weekly, or monthly rate-limit windows with `limit_window_seconds` and an exact reset. Spend-control rows, code-review rows, and unknown durations are excluded.
- **xAI:** credit periods with both `currentPeriod.start` and `currentPeriod.end`. A billing-end date without a start is excluded.
- **Cursor:** the included API budget when `cursorBillingCycleStartDay` is set. The calendar-month fallback, partial or unknown model spend, and spend-only rows are excluded.
- **Custom local estimates:** `utc-day` request and priced budget percentages. `rolling` windows and unpriced rows are excluded.

Everything else (rolling windows, RPM, balance, status, unlimited rows) is left unchanged.

### Include subagent session tokens

Session totals count only the current session by default. `sessionTokenScope: "tree"` adds every subagent session, counted once. This applies to the session tokens in `/quota` and the sidebar.

### Countdown and label styles

- Reset countdowns in `/quota` and terminal `show` are exact and spaced by default, such as `6d 1h 17m`, `2h 14m`, or `37m`. Partial minutes round up.
- `resetTimeSpaced: false` writes `2d5h14m` instead of `2d 5h 14m` in `/quota` and terminal `show`. Minute-only values, `reset`, and rounding stay the same.
- `resetTimeDecimals` (`0` to `4`) shows the largest unit as a decimal, such as `5.7d` or `1.4h`, in terminal `show`. It wins over `resetTimeSpaced` there.
- `percentLabelStyle: "bare"` shows `81%` instead of `81% left` (or `19%` instead of `19% used`) in `/quota` and terminal `show`. These reports then use `Quota [Remaining]` or `Quota [Used]` as the heading.
- The sidebar always uses one-decimal compact countdowns (`2.9h`, `2.9d`) and bare percentages, independently of these report styles. Missing, invalid, and expired countdowns are omitted. `percentDisplayMode` still selects remaining or used quota.

## Custom providers

A custom provider connects OpenCode Quota to a provider that is not built in, or tunes a maintained local estimate. Add a global `quotaProviders` entry to the settings file:

- `quotaProviders` is global-only and keeps file order.
- `id` is the stable identity. Add `providerId` only when it differs.
- `modelIds` affects only `onlyCurrentModel`. Use exact, case-sensitive model IDs without the outer provider prefix, or omit it to cover every model for that provider.
- Remote APIs use a fixed authenticated `GET`. Formats: `quota-v1`, `json-v1`, and `openrouter-key-v1`. `json-v1` needs an `adapter` with 1–16 mappings; paths are literal own-property segment arrays, not JSONPath. See [response rules](providers.md#custom-providers).
- Local estimates support 1–16 UTC-day or rolling request windows. Counters live under `~/.local/state/opencode/opencode-quota/quota-providers/`.
- Automatic models.dev matching runs first. Add `pricingModelMap` only when it cannot find one clear model. `pricingModelMap` cannot override a successful automatic match.
- If any request cannot be priced, request counts stay visible and the budget percentage is reported unavailable.
- Credentials resolve from `apiKeyEnv`, trusted global `provider.<providerId>.options.apiKey`, then API-key logins saved in OpenCode 2 (`opencode.db`).
- Definitions run automatically with `enabledProviders: "auto"`. A manual list must include `quota-providers` and every built-in provider you still want.
- To tune maintained estimates, use the reserved `alibaba-coding-plan` ID and its window shape. Do not add a duplicate normal provider block.
- Not accepted: project secrets, scripts, methods, custom headers, templates, executable mappings, regular expressions, JSONPath, and automatic endpoint discovery.
- A custom model provider still needs its normal OpenCode `provider` block: that block tells OpenCode how to use the model, and `quotaProviders` tells OpenCode Quota how to measure it.

<details>
<summary><strong>Complete example (no separate quota settings file)</strong></summary>

Without a `quota-toast` file, you can put `experimental.quotaToast.quotaProviders` in the global OpenCode config. Set up the normal OpenCode `provider` block yourself:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "experimental": {
    "quotaToast": {
      "enabledProviders": "auto",
      "quotaProviders": [
        {
          "id": "openrouter-primary",
          "providerId": "openrouter",
          "label": "OpenRouter Primary",
          "mode": "remote-api",
          "url": "https://openrouter.ai/api/v1/key",
          "format": "openrouter-key-v1",
          "apiKeyEnv": "OPENROUTER_API_KEY",
        },
        {
          "id": "private-gateway",
          "label": "Private Gateway Estimate",
          "mode": "local-estimate",
          "modelIds": ["model-a"],
          "windows": [
            { "id": "daily", "label": "Daily", "type": "utc-day", "requestLimit": 1000, "usdBudget": 25 },
          ],
        },
      ],
    },
  },
  "provider": {
    "private-gateway": {
      "models": { "model-a": {} },
    },
  },
}
```

</details>

## Full configuration reference

Most settings go in the `opencode-quota/quota-toast.jsonc` or `.json` file described above. The `quotaProviders` list stays in that file when it exists; otherwise it uses the global OpenCode JSONC/JSON `experimental.quotaToast` section; do not duplicate it in a second file. Existing `experimental.quotaToast` settings still work.

Provider credentials (API keys, cookies, tokens) are never set here. See [API keys](providers.md#api-keys) and each provider's [setup notes](providers.md#provider-setup-notes).

<details>
<summary><strong>All settings</strong></summary>

### Core settings

| Option                        | Default        | Meaning |
| ----------------------------- | -------------- | ------- |
| `enabled`                     | `true`         | Master switch. When `false`, quota collection stops: the sidebar shows no data and terminal `show` exits with `Quota disabled in config (enabled: false).` |
| `enabledProviders`            | `"auto"`       | Auto-detect providers, or list them. Use `quota-providers` for custom definitions. |
| `quotaProviders`              | `[]`           | Custom provider definitions (global-only). See [Custom providers](#custom-providers). |
| `minIntervalMs`               | `300000`       | Minimum time between provider updates. |
| `requestTimeoutMs`            | `5000`         | Provider request timeout in milliseconds. |
| `formatStyle`                 | `singleWindow` | Terminal `show` text only: `singleWindow` shows one reset period per provider; `allWindows` shows all. `/quota` shows all windows; the sidebar selects the lowest remaining percentage from all windows. Old `classic`/`grouped` names still work. |
| `percentDisplayMode`          | `remaining`    | `remaining` shows what is left; `used` shows what is used. |
| `quotaProjection`             | unset          | `"runway"` adds a **Runs out** estimate. See [above](#estimate-when-fixed-quota-runs-out). |
| `percentLabelStyle`           | unset          | `bare` drops `left`/`used` from report labels. `full` is also accepted. The sidebar always uses bare percentages. |
| `accountingDetail`            | `summary`      | `summary` or `detailed`. See [above](#show-accounting-detail). |
| `resetTimeDecimals`           | unset          | `0`–`4`: show the largest countdown unit as a decimal in terminal `show`. The sidebar always uses one decimal. |
| `resetTimeSpaced`             | `true`         | `false` writes report countdowns without spaces (`2d5h14m`). |
| `onlyCurrentModel`            | `false`        | Show only the current model's provider, when it can be found. |
| `waitForQuotaReset`           | `true`         | On by default. When a request hits a provider limit, the plugin asks that model's provider for fresh quota; if a window shows 0% left, OpenCode retries 1 minute after the earliest such window resets (at most 5 hours per wait) instead of retrying quickly or giving up. Interrupt the session to stop waiting (Esc twice in the TUI). Set `"waitForQuotaReset": false` to keep OpenCode's normal retry timing. |
| `showSessionTokens`           | `true`         | Show `Session input/output tokens` when available. Cached input appears in parentheses next to input. |
| `sessionTokenScope`           | `"current"`    | `current` or `tree` (adds subagent sessions). See [above](#include-subagent-session-tokens). |
| `pricingSnapshot.source`      | `"auto"`       | Token pricing for session tokens: `auto`, `bundled`, or `runtime`. |
| `pricingSnapshot.autoRefresh` | `7`            | Refresh local pricing after this many days. |

### TUI settings

| Option                    | Default    | Meaning |
| ------------------------- | ---------- | ------- |
| `tuiCommandDisplay`       | `"dialog"` | Where TUI `/quota` reports appear: `dialog` (popup, no chat message) or `inline` (in the chat). Web and Desktop always use the chat. If a session is open in the TUI and in Web, `dialog` also removes a Web `/quota` report from the chat while the TUI shows that session. |
| `tuiSidebarPanel.enabled` | `true`     | Populate the always-visible sidebar `Quota` table. When `false`, the panel shows no data. |

The sidebar `Quota` rows are always present, muted, and headerless, with no bars or runway. Provider names sit on the left; optional compact windows (`1h`, `5h`, `7d`, `30d`), one-decimal resets (`2.9h`, `2.9d`), and bare percentages align on the right. Non-time labels such as Budget and Current balance are omitted, with no placeholder for missing times. OpenCode Zen rows and errors are hidden from the sidebar only; `/quota` and terminal `show` are unchanged.

### Provider settings

| Option                       | Default                            | Meaning |
| ---------------------------- | ---------------------------------- | ------- |
| `anthropicBinaryPath`        | `"claude"`                         | Claude CLI command or path. With `"claude"`, OpenCode's `PATH` is tried first, then the usual install folders (not on Windows). |
| `opencodeGoWindows`          | `["rolling", "weekly", "monthly"]` | Which OpenCode Go windows appear: Five-hour, Weekly, and Monthly. |
| `opencodeMonthlyLimit`       | unset                              | Override the OpenCode Zen monthly budget in USD. |
| `cursorPlan`                 | `"none"`                           | Cursor included API budget: `none`, `pro`, `pro-plus`, or `ultra`. |
| `cursorIncludedApiUsd`       | unset                              | Override Cursor's monthly included API budget in USD. |
| `cursorBillingCycleStartDay` | unset                              | Billing day `1`–`28`. Unset uses the local calendar month. |

### Telemetry settings

| Option              | Default | Meaning |
| ------------------- | ------- | ------- |
| `telemetry.enabled` | `false` | Publish quota and cache-age gauges through OpenCode's global OpenTelemetry `MeterProvider`. No extra provider calls. |

See [External integration](external-integration.md) for details.

</details>
