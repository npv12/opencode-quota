[← Back to README](../../README.md)

# Use quota data in other tools

OpenCode Quota can share its cached quota data with scripts, status bars, CI, and monitoring tools. None of these options make extra provider requests.

| What you need | Use |
| --- | --- |
| Run a command and get JSON | `opencode-quota show --json` |
| Read cached JSON | `opencode-quota show --json` |

## 1. Get JSON from a command

```bash
opencode-quota show --json

# Only Copilot
opencode-quota show --json --provider copilot

# Exit with an error when comparable quota is below 5% (for example in CI)
npx @npv12/opencode-quota show --json --threshold 5
```

It works with OpenCode closed: it reads the quota OpenCode saved last and never asks a provider. See [Terminal commands](troubleshooting.md#terminal-commands).

`--threshold` exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Results are complete and none is below the threshold |
| `1` | At least one comparable cached percentage is below the threshold, or the command failed |
| `2` | Results were incomplete or no comparable percentage was found |

For a status bar, pick the first comparable percentage of each provider:

```bash
opencode-quota show --json | jq -r '[.providers|to_entries[]|select(.value.status==\"ok\")|first(.value.entries[]?|select(.renderType==\"percent\" and .percentRemaining!=null))|(.percentRemaining|floor|tostring)+\"%\"]|join(\" | \")'
```

## Export files and metrics

This fork does not write an export file or OpenTelemetry metrics.

## JSON basics

`show --json` uses JSON schema version `3`. Every provider has a `status`, and the other fields depend on it:

| Status | Meaning | Fields |
| --- | --- | --- |
| `ok` | Data is available | `fetchedAt`, `entries` |
| `partial` | Some data worked and some failed | `fetchedAt`, `entries`, `errors` |
| `error` | The provider failed | `fetchedAt`, a safe `error` message |
| `unavailable` | Not set up, or no saved data | none required |

Treat `status: "partial"` as incomplete. A provider's `error` (and each `errors` message) is the short text the TUI shows, for example `Sign in again` or `Provider error 503`. `show --json` writes the quota OpenCode saved last, including a provider's last failed check.

A percentage entry has `renderType: "percent"` and `percentRemaining`. A value entry has `renderType: "value"` and `value`: the text the TUI shows (for example `$12.50 left` or `$2.50/$10.00`), or `Enabled` / `Disabled` for a yes/no row. A provider can have several rows of both kinds, so select by `renderType` and `resultType`, never by position. The `words` settings never change JSON, threshold checks use percentage rows only, and version 3 has no row prominence or separate used, limit, and remaining amounts.

Every entry has these fields:

| Field | Meaning |
| --- | --- |
| `id` | The row's stable id, `provider.key` (for example `copilot.allowance`), the same id the TUI's hide, rename and order settings use. The rows of two accounts of one provider share it; `account` tells them apart. |
| `name` | `Provider (account) Label`, for example `Copilot (pro) Premium requests` |
| `resultType` | `quota` (rate limits too), `usage` (spending too), `budget`, `balance`, or `status` |
| `acquisitionMethod` | `remote_api`, `dashboard_scrape`, `local_cli`, or `local_estimation` |
| `ownership` | `maintained`, or `user_configured` for rows from `providers.custom` |
| `authority` | `provider_reported` or `locally_derived` |

Optional entry fields are `account` (the account the TUI shows, for example `pro`; two logins with the same account get `pro` and `pro 2`), `window` (for example `5h`, `Weekly`, `Monthly`) and `resetAt` (Unix seconds).

Secrets, credentials, URLs, checked paths, and raw provider responses remain excluded from public JSON. Use `/quota` for live diagnostics.

Rows from a `providers.custom` definition appear under `providers["quota-providers"]`, each with the id `quota-providers.custom.<definition id>.<key>`. After a check, that provider's `sources` lists every definition except the built-in tunings, in file order, each with exactly `id`, `providerId`, `status` (`ok`, `error` or `unavailable`) and `entryCount`. A switched-off definition has `"enabled": false` instead of a `status`, and `entryCount` `0`. A definition can be `ok` while failed mapping candidates make the provider `partial`.

<details>
<summary><strong>Small JSON example</strong></summary>

```json
{
  "version": 3,
  "exportedAt": 1748736000,
  "fromCache": true,
  "cacheAgeSeconds": 42,
  "providers": {
    "copilot": {
      "status": "ok",
      "fetchedAt": 1748735958,
      "entries": [
        {
          "id": "copilot.allowance",
          "name": "Copilot (pro) Premium requests",
          "account": "pro",
          "resultType": "quota",
          "acquisitionMethod": "remote_api",
          "ownership": "maintained",
          "authority": "provider_reported",
          "renderType": "percent",
          "percentRemaining": 62.3
        }
      ]
    }
  }
}
```

</details>
