# Contributing to OpenCode Quota

## Development setup

1. Install [Bun](https://bun.sh/) (v1.3.14+).
2. Clone the repository.
3. Run `bun install` to install dependencies.

`bun install` runs `prepare`, which installs Lefthook hooks.

## Commands

- `bun run build` — compile TypeScript to `dist/`
- `bun run typecheck` — type-check without emitting
- `bun test` — run all tests
- `bun run test:watch` — run tests in watch mode

Run `bun run typecheck && bun run build && bun test` for the full verification gate.

## CI

The repository uses GitHub Actions:

- Job: `quality` on Node `24.x`
- Steps: frozen install, `bun run typecheck && bun run build && bun test`

## Release

Create a GitHub release with tag `v<version>` (e.g., `v5.0.0`). The publish workflow will:

1. Check out the release tag
2. Install dependencies with `bun install --frozen-lockfile`
3. Set the package version from the release tag
4. Run typecheck and build
5. Publish to npm with provenance
6. Commit the version bump back to main

## Branch protection

- Require status checks from workflow `CI` for `quality`
- Typical names look like `quality` or `CI / ...` variants

## Before submitting a PR

- `bun run typecheck` passes
- `bun run build` succeeds
- `bun test` passes
