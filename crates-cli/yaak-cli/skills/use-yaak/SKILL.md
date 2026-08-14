---
name: use-yaak
description: >
  Build and run HTTP API requests with the Yaak CLI (`yaak`): create workspaces,
  folders, environments and variables, author HTTP requests, configure
  authentication (OAuth 2.0, bearer tokens, API keys, basic, JWT, AWS SigV4),
  send them individually or a whole folder/workspace at once, chain one
  request's response into the next, and import existing APIs from OpenAPI,
  Postman, Insomnia, or cURL. Use this skill whenever the user mentions Yaak, a
  Yaak workspace, or the `yaak` command, and also when they ask to try, hit,
  call, exercise, or smoke test an HTTP or REST endpoint, to save or organize
  API requests for reuse, to set up API requests for manual testing, to add auth
  to a saved request, to turn an OpenAPI or Postman collection into runnable
  requests, or to run a saved request suite against staging versus production.
  Prefer this over one-off `curl` commands whenever the requests should be
  saved, reused, shared, or run as a set.
allowed-tools: Bash(yaak:*), Bash(which:*), Bash(command:*), Bash(npm:*), Bash(npx:*)
---

# Use Yaak

<!--
  Managed by the Yaak CLI. `yaak agent install` replaces this file wholesale on
  every run, so local edits are lost. To add your own guidance, write a separate
  skill or use your tool's project instructions instead.
  yaak-cli-version: __YAAK_CLI_VERSION__
-->

Yaak is a desktop API client. The `yaak` CLI reads and writes the **same local
database as the desktop app**, so anything you create shows up in the app
immediately, and vice versa. There is no server and no sign-in: `yaak auth` is
only for publishing plugins to the Yaak registry.

Two consequences worth holding onto. Requests you create are permanent user data
in an app they use, not scratch files, so name them the way the user would and
clean up anything created just to test. And because the app is right there, the
CLI is usually the wrong place to *read* a response in detail; it is the right
place to build, organize, and run requests.

## The CLI describes itself

**This skill deliberately does not list fields, body types, auth strategies, or
template functions.** The user's CLI version and installed plugins decide what
exists, so any list written here would eventually be wrong. Ask the CLI:

```bash
yaak --help                          # commands, plus agent hints at the bottom
yaak <command> --help                # flags for one command
yaak request schema http --pretty    # full request model, with guidance per field
yaak template-function list [filter] # template functions from installed plugins
yaak template-function show <name>   # one function's arguments
```

`request schema http` is generated from the real model and merges in the auth
strategies contributed by plugins, so it is the authoritative answer for what a
request payload may contain and what each auth strategy needs. `workspace`,
`environment`, and `folder` have `schema` subcommands too.

Read the relevant schema before writing a JSON payload you are not certain of.
That is faster than a failed send, and it stays correct as Yaak changes.

## Resource model

- **Workspace** (`wk_…`) is the top-level container.
- **Folder** (`fl_…`) groups requests and can nest. Folders carry headers and
  authentication that child requests inherit, which is the usual way to apply
  one token to a whole group.
- **Request** (`rq_…`) is a single HTTP, gRPC, or WebSocket request. The CLI can
  currently only create and send HTTP ones.
- **Environment** (`ev_…`) holds variables. Each workspace has a base
  environment plus any number of sub-environments; a sub-environment overrides
  base variables of the same name and is chosen per send with `-e`.
- **Cookie jar** (`cj_…`) stores cookies per workspace. The oldest is used by
  default, so this normally needs no attention.

IDs are prefix-typed, so you can always tell what an ID refers to. Commands that
take a workspace ID infer it when exactly one workspace exists.

## Getting oriented

```bash
yaak --version || npm install -g @yaakapp/cli
yaak workspace list
```

Pick the workspace matching the user's project before changing anything, and
create one only when nothing fits.

### Skill freshness

The CLI writes this skill, so an upgraded CLI can leave it behind. That failure
is silent: nothing errors, the skill just stops mentioning things the CLI can
now do. Check once per session, alongside the commands above:

```bash
yaak --help 2>&1 | grep -A2 "Agent tooling:"
```

If it reports the skill is out of date, run `yaak agent install` and tell the
user to restart their coding tool. This session keeps running on the old copy
until they do, so finish the current request either way. Check once and do not
re-run it after acting.

**When the CLI and this skill disagree, the CLI is right.**

## Core workflows

**Start from a spec when one exists.** `yaak import <file>` auto-detects OpenAPI,
Swagger, Postman, Insomnia, cURL, and Yaak exports, and beats authoring requests
by hand every time.

**Make the host swappable.** Put the base URL in a base-environment variable,
reference it as `${[ base_url ]}`, then add a sub-environment per deployment
target. Now `yaak -e ev_staging send <wk_id>` runs everything against staging.

**Chain instead of shell-plumbing.** A request can read another request's
response directly, and Yaak sends the dependency first if it needs to:

```
${[ response.body.path(request='rq_login', path='$.token') ]}
```

Run `yaak template-function show response.body.path` for its arguments,
including how to control when the upstream request re-sends. Chain when a
request genuinely depends on another's response; to merely run requests in
order, `yaak send <fl_id>` already does that.

**Run a set.** `yaak send` accepts a folder or workspace ID, with `--fail-fast`
and `--parallel`. Workspace and request IDs survive an export/import, so a
committed `yaak export` plus `--data-dir ./.yaak` gives a runnable suite in CI.

## Reading results

A plain send writes only the response body to stdout. Yaak also stores every
response, so the reliable way to see what happened is to ask afterwards rather
than to parse the send output:

```bash
yaak response show rq_abc123     # latest response for a request, as JSON
yaak response list rq_abc123     # its history, newest first
yaak response body rq_abc123     # just the body
```

`response show` gives status, reason, timing, headers, the final URL, and any
transport error. Pass a response ID for a specific one.

`-v` on a send prints the same information prefixed `*`, `>`, and `<`, with the
body after the last `<` header line:

```bash
yaak -v request send rq_abc123 2>&1 | grep '^< HTTP'
```

That works, but `response show` is still better when you need to act on the
result, since it gives you fields rather than text to parse.

Exit code 1 means the send did not complete: an unresolved template variable, an
unreachable host, a TLS failure. **HTTP error statuses are not failures.** Like
`curl`, a 404 or 500 exits 0, and a folder of requests that all return 500
reports success. Never tell the user an API is healthy based on a clean exit;
check the status.

## Execution rules

1. Resolve the workspace before mutating, and prefer an existing one.
2. Read the schema rather than guessing field names, auth fields, or body shapes.
3. `update` takes a JSON merge patch keyed by `id`: send only what changes, and
   note that arrays are replaced wholesale, not merged.
4. Deletes need `--yes` in a non-interactive shell. Confirm with the user first.
5. Never write a real secret into an environment variable on the user's behalf.
   Reference one and let them fill in the value.
6. Verify what you built by sending it, and report the real HTTP status.
7. If the CLI warns on stderr that a newer version is available, offer to run
   the upgrade command it prints, then re-run `yaak agent install` so this
   skill updates too.
