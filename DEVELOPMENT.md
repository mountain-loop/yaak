# Developer Setup

Yaak is a combined Node.js and Rust monorepo. It is a [Tauri](https://tauri.app) project, so
uses Rust and HTML/CSS/JS for the main application but there is also a plugin system powered
by a Node.js sidecar that communicates to the app over gRPC.

Because of the moving parts, there are a few setup steps required before development can
begin.

## Prerequisites

Make sure you have the following tools installed:

- [Node.js](https://nodejs.org/en/download/package-manager) (v24+)
- [Rust](https://www.rust-lang.org/tools/install)
- [Vite+](https://vite.dev/guide/vite-plus) (`vp` CLI)

Check the installations with the following commands:

```shell
node -v
npm -v
vp --version
rustc --version
```

Install the NPM dependencies:

```shell
npm install
```

Run the `bootstrap` command to do some initial setup:

```shell
npm run bootstrap
```

## Run the App

After bootstrapping, start the app in development mode:

```shell
npm start
```

## Run the App in a Browser

The client can also run as a plain web page, with no Tauri and no local process
behind it. Set `YAAK_TARGET=web` and start the frontend on its own:

```shell
YAAK_TARGET=web npm run dev --workspace @yaakapp/yaak-client
```

That flag picks the browser host in `packages/platform/src/web/`, which answers
commands from an IndexedDB database the page owns instead of from the Rust
engine. Data persists across reloads and is shared between tabs on the same
origin. Sending HTTP is not available yet — the Send button reports that and
everything else about the request is still saved. `packages/platform/src/web/README.md`
lists which commands the browser host implements and which it declines.

Desktop builds are unaffected: without the flag the platform package installs
the Tauri host exactly as before.

## SQLite Migrations

New migrations can be created from the `src-tauri/` directory:

```shell
npm run migration
```

Rerun the app to apply the migrations.

_Note: For safety, development builds use a separate database location from production builds._

## Lezer Grammar Generation

```sh
# Example
lezer-generator components/core/Editor/<LANG>/<LANG>.grammar > components/core/Editor/<LANG>/<LANG>.ts
```

## Linting and Formatting

This repo uses [Vite+](https://vite.dev/guide/vite-plus) for linting (oxlint) and formatting (oxfmt).

- Lint the entire repo:

```sh
npm run lint
```

- Format code:

```sh
npm run format
```

Notes:

- A pre-commit hook runs `vp lint` automatically on commit.
- Some workspace packages also run `tsc --noEmit` for type-checking.
- VS Code users should install the recommended extensions for format-on-save support.
