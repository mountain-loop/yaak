# Yaak CLI

The `yaak` CLI for publishing plugins and creating/updating/sending requests.

## Installation

```sh
npm install @yaakapp/cli
```

## Agentic Workflows

The `yaak` CLI is primarily meant to be used by AI agents, and has the following features:

- `schema` subcommands to get the JSON Schema for any model (eg. `yaak request schema http`)
- `--json '{...}'` input format to create and update data
- `--verbose` mode for extracting debug info while sending requests
- The ability to send entire workspaces and folders (Supports `--parallel` and `--fail-fast`)

### Agent Setup

Install the Yaak skill so your coding agent knows how to drive the CLI:

```sh
yaak agent install                                  # every agent found on this machine
npx skills add mountain-loop/yaak --skill use-yaak  # or with the skills CLI
```

Claude Code and Codex can install it as a plugin instead. In Claude Code, run
`/plugin install yaak --marketplace mountain-loop/yaak`; the plugin also registers the
`yaak mcp` server. In Codex, run `codex plugin marketplace add mountain-loop/yaak`,
then `codex plugin add yaak@yaak`.

Any MCP client can run the server over stdio:

```json
{
  "mcpServers": {
    "yaak": { "command": "npx", "args": ["-y", "@yaakapp/cli", "mcp"] }
  }
}
```

### Example Prompts

Use the `yaak` CLI with agents like Claude or Codex to do useful things for you.

Here are some example prompts:

```text
Scan my API routes and create a workspace (using yaak cli) with
all the requests needed for me to do manual testing?
```

```text
Send all the GraphQL requests in my workspace
```

## Description

Here's the current print of `yaak --help`

```text
Yaak CLI - API client from the command line

Usage: yaak [OPTIONS] <COMMAND>

Commands:
  auth         Authentication commands
  plugin       Plugin development and publishing commands
  send         Send a request, folder, or workspace by ID
  workspace    Workspace commands
  request      Request commands
  folder       Folder commands
  environment  Environment commands

Options:
      --data-dir <DATA_DIR>        Use a custom data directory
  -e, --environment <ENVIRONMENT>  Environment ID to use for variable substitution
  -v, --verbose                    Enable verbose send output (events and streamed response body)
      --log [<LEVEL>]              Enable CLI logging; optionally set level (error|warn|info|debug|trace) [possible values: error, warn, info, debug, trace]
  -h, --help                       Print help
  -V, --version                    Print version

Agent Hints:
  - Template variable syntax is ${[ my_var ]}, not {{ ... }}
  - Template function syntax is ${[ namespace.my_func(a='aaa',b='bbb') ]}
  - View JSONSchema for models before creating or updating (eg. `yaak request schema http`)
  - Deletion requires confirmation (--yes for non-interactive environments)
```
