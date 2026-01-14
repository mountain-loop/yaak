# Yaak Plugin API

Yaak is a desktop [API client](https://yaak.app/blog/yet-another-api-client) for
interacting with REST, GraphQL, Server Sent Events (SSE), WebSocket, and gRPC APIs. It's
built using Tauri, Rust, and ReactJS.

Plugins can be created in TypeScript, which are executed alongside Yaak in a NodeJS
runtime. This package contains the TypeScript type definitions required to make building
Yaak plugins a breeze.

## Quick Start

The easiest way to get started is by generating a plugin with the Yaak CLI:

```shell
npx @yaakapp/cli generate
```

For more details on creating plugins, check out
the [Quick Start Guide](https://yaak.app/docs/plugin-development/plugins-quick-start)

## Installation

If you prefer starting from scratch, manually install the types package:

```shell
npm install -D @yaakapp/api
```
