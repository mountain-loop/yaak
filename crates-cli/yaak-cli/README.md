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
