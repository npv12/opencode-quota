[← Back to README](../../README.md)

# Configuration

Most people need no settings. To change one, open `/quota` in the TUI and use its Settings tabs.

## Where settings live

One global file, `settings.jsonc`:

- `~/.config/opencode/opencode-quota/settings.jsonc` on every OS (`$XDG_CONFIG_HOME/opencode/...` when `XDG_CONFIG_HOME` is set)
- `$OPENCODE_CONFIG_DIR/opencode-quota/settings.jsonc` when `OPENCODE_CONFIG_DIR` is set (it replaces the global folder, like OpenCode 2)

There are no project settings. Comments and trailing commas are allowed. Every key is optional; a missing or invalid value uses its default.

The file holds only the settings you change, so the rest follow their defaults, also when a newer version changes one. Without the file nothing is written; the first Save in the window creates it. Settings from 4.x or 5.x convert on the first start: see [Updating](updating.md#moving-from-5x).

The TUI quota window's tabs are Usage, Limits, then the Settings tabs **Layout** (**All places** and **Sidebar**), **Colors** and **Providers**. `/quota` opens it on Limits. While you edit, the sidebar and the quota window show your unsaved changes. **Save** writes them and keeps the file's comments, **Discard** drops them, and **Reset page** (**Reset tab** on Colors and Providers) puts that page back to its defaults on Save, except row names. A file edit or a Save reaches every open TUI within a few seconds.

Two settings are file only: `providers.custom` ([custom providers](providers.md#custom-providers)) and `providers.anthropic.binaryPath`. Credentials never go in this file: see [API keys](providers.md#api-keys).

Nest the keys in the file:

```jsonc
{
  "sidebar": { "sessionTokens": false },
  "colors": { "good": "green" },
  "layout": { "barWidth": 10 },
  "words": { "percent": "bare", "reset": "decimal" },
  "providers": { "off": ["openai"], "checking": { "requestTimeoutMs": 12000 } },
}
```

## TUI surfaces

`/quota` opens the window on Limits. `tab` moves between Limits, Usage and Settings. The Settings tabs are **Layout** (**All places** and **Sidebar**), **Colors** and **Providers**. The sidebar panel shows the limiting window for each provider, with a bare percentage and a compact reset time. Percentages follow the Colors settings.

## All settings

<details>
<summary>Settings by section</summary>

### Sidebar

This fork shows only the sidebar panel. The `collapsed`, `statusLine` and `toast` keys stay readable for settings converted from upstream, but no surface shows them.

The sidebar's section is `sidebar`: `show`, `hidden`, `providerOrder`, `rowOrder`, `names` and `sessionTokens`. The fork's sidebar itself stays minimal and headerless: it shows one line per provider account with the limiting window, a compact reset and a bare percent. The other sections (`collapsed`, `statusLine`, `toast`) are still read from files converted from upstream, but no surface shows them.

### Colors

Roles are `good`, `warning`, `low`, `empty`, `title`, `provider`, `account`, `label`, `percent`, `reset`, `value`, `error`, `statusName`, `separator`, and `arrows`. Each `colors.<role>` follows the theme when unset. Set a role to `text`, `muted`, `accent`, `green`, `yellow`, `red`, `blue`, `bar`, or a `#rrggbb` color. `bar` follows the row's level color: by the share left against `colors.warningBelow` and `colors.lowBelow`, or by pace with `colors.levelBy: "pace"`.

| Setting | Default | Values |
| --- | --- | --- |
| `colors.levelBy` | `"left"` | `left` or `pace`. With `pace`, the level colors follow how fast a limit is used against even use until its reset: `good` at or under even use (an untouched limit included), `warning` up to 5 points faster than even use, `low` faster than that. Before a tenth of the window has passed, a fast pace says too little, so the row follows the share left, and a nearly used-up limit is still `low`. A row without a reset time or a known window length follows the share left. Whether a toast shows after a reply (`toast.afterReply: "low"`) still goes by the share left. **Bar colors follow** on the Colors tab. |
| `colors.warningBelow` | `50` | Whole number 0–100, percent left below which quota is getting low. |
| `colors.lowBelow` | `20` | Whole number 0–100, percent left below which quota is almost out. |

### Layout

| Setting | Default | Values |
| --- | --- | --- |
| `layout.bar` | `"blocks"` | `blocks`, `shades`, `line`, `squares`, `dots`, `none`. |
| `layout.barWidth` | `"fill"` | `fill` takes the room the other columns leave, at most 20 cells on the sidebar and 10 on the collapsed panel; or a whole number 1–30. |
| `layout.evenUse` | `true` | The `┃` mark where even use until the reset would be, in the bars of every place, the Limits tab included. It is not the bar's value. **Even-use mark** on Layout's All places page. |
| `layout.indent` | `1` | Whole number 0–4. |
| `layout.labelWidth` | `8` | Whole number 3–20: the most columns a row name takes. |
| `layout.providerGap` | `1` | Whole number 0–2. |
| `layout.separator` | `" · "` | Up to 5 characters. |

### Words

Every place follows these, so in the TUI they are on **Layout → All places**. JSON output never changes with them.

| Setting | Default | Values |
| --- | --- | --- |
| `words.percent` | `"left"` | `left`, `remaining`, `bare`, `used`. The sidebar always writes a bare percent; the Limits tab follows this setting. |
| `words.reset` | `"smart"` | `smart`, `exact`, `compact`, `short`, `decimal`, or `percent`: the share of the window's time left (used, with `words.percent` `used`), then the time in its largest unit (`0%/91% 28d`); only the time when the window's start is unknown. |
| `words.resetDecimals` | `1` | Whole number 0–4. |
| `words.rowNames` | `"short"` | `short` (`5h`, `7d`) or `full` (`Weekly`), on the sidebar. |
| `words.detail` | `"summary"` | `detailed` includes supplementary rows. |
| `words.onlyCurrentModel` | `false` | Show only providers serving the current model. |
| `words.sessionTokens` | `"current"` | `current` counts this chat; `tree` adds its subagent sessions. |

### Providers

| Setting | Default | Values |
| --- | --- | --- |
| `providers.off` | `[]` | Provider ids switched off. `custom` means every custom definition. |
| `providers.custom` | `[]` | [Custom provider](providers.md#custom-providers) definitions, file only. |
| `providers.anthropic.binaryPath` | `"claude"` | CLI command or absolute or `~/` path without `..`, file only. |
| `providers.cursor.plan` | `"none"` | `none`, `pro` ($20 of API use a month), `pro-plus` ($70), `ultra` ($400). |
| `providers.cursor.includedApiUsd` | `null` | Positive monthly USD amount, used instead of the plan's. |
| `providers.cursor.billingCycleStartDay` | `null` | The day of the month your Cursor bill renews, 1–28. Unset uses the calendar month. |
| `providers.opencode.monthlyLimitUsd` | `null` | Positive monthly USD amount, used instead of the Console's budget or credit limit. |
| `providers.checking.minIntervalMs` | `300000` | Positive milliseconds between provider checks. |
| `providers.checking.requestTimeoutMs` | unset | Positive milliseconds, for every provider. Unset, each uses its own: `5000`, except OpenCode Zen and Xiaomi MiMo `10000`, the Alibaba Coding Plan and Token Plan `10000` for the local CLI they run, and Google AGY and Gemini CLI `8000` to sign in and `6000` for the quota. xAI's plan-label lookup waits at most `2000`. |
| `providers.checking.waitForQuotaReset` | `true` | On a model limit error, wait until 1 minute after the earliest used-up window resets, at most 5 hours. `false` keeps normal retry timing. |
| `providers.pricing.source` | `"auto"` | `auto`, `bundled`, `runtime`. |
| `providers.pricing.autoRefreshDays` | `7` | Whole number of days, at least 1. |

