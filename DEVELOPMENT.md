# Developer Setup

Yaak is a combined Node.js and Rust monorepo. It is a [Tauri](https://tauri.app) project, so 
uses Rust and HTML/CSS/JS for the main application but there is also a plugin system powered
by a Node.js sidecar that communicates to the app over gRPC.

Because of the moving parts, there are a few setup steps required before development can 
begin.

## Prerequisites

Make sure you have the following tools installed:

- [Node.js](https://nodejs.org/en/download/package-manager)
- [Rust](https://www.rust-lang.org/tools/install)

Check the installations with the following commands:

```shell
node -v
npm -v
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

_NOTE: Run with `YAAK_PLUGINS_DIR=<Path to yaakapp/plugins>` to re-build bundled plugins_

## Run the App

After bootstrapping, start the app in development mode:

```shell
npm start
```

_NOTE: If working on bundled plugins, run with `YAAK_PLUGINS_DIR=<Path to yaakapp/plugins>`_

## SQLite Migrations

New migrations can be created from the `src-tauri/` directory:
   
```shell
cd src-tauri
sqlx migrate add migration-name
```

Run the app to apply the migrations. 

If nothing happens, try `cargo clean` and run the app again.

_Note: Development builds use a separate database location from production builds._
