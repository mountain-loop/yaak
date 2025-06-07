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

## Run the App

After bootstrapping, start the app in development mode:

```shell
npm start
```

## SQLite Migrations

New migrations can be created from the `src-tauri/` directory:
   
```shell
npm run migration
```

Run the app to apply the migrations. 

If nothing happens, try `cargo clean` and run the app again.

_Note: Development builds use a separate database location from production builds._

## Lezer Grammer Generation

```sh
# Example
lezer-generator components/core/Editor/<LANG>/<LANG>.grammar > components/core/Editor/<LANG>/<LANG>.ts
```
