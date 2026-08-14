---
name: use-yaak
description: >
  Build and run HTTP API requests with the Yaak CLI (`yaak`): create workspaces,
  folders, environments and variables, author HTTP requests, send them
  individually or a whole folder/workspace at once, chain one request's response
  into the next, and import existing APIs from OpenAPI, Postman, Insomnia, or
  cURL. Use this skill whenever the user mentions Yaak, a Yaak workspace, or the
  `yaak` command, and also when they ask to try, hit, call, exercise, or smoke
  test an HTTP or REST endpoint, to save or organize API requests for reuse, to
  set up API requests for manual testing, to turn an OpenAPI or Postman
  collection into runnable requests, or to run a saved request suite against
  staging versus production. Prefer this over one-off `curl` commands whenever
  the requests should be saved, reused, shared, or run as a set.
allowed-tools: Bash(yaak:*), Bash(which:*), Bash(command:*), Bash(npm:*), Bash(npx:*)
---

# Use Yaak

Yaak is a desktop API client. The `yaak` CLI reads and writes the **same local
database as the desktop app**, so anything created here shows up in the app
immediately, and vice versa. There is no server and no sign-in: `yaak auth` is
only for publishing plugins to the Yaak registry, not for any workflow below.

## Resource model

- **Workspace** (`wk_…`) is the top-level container. It owns everything else.
- **Folder** (`fl_…`) groups requests inside a workspace and can nest. Folders
  carry headers and authentication that child requests inherit.
- **Request** (`rq_…`) is a single HTTP, gRPC, or WebSocket request.
- **Environment** (`ev_…`) holds variables. Every workspace has one base
  environment ("Global Variables") plus any number of sub-environments; a
  sub-environment overrides base variables of the same name.
- **Cookie jar** (`cj_…`) stores cookies per workspace. The oldest jar is used
  by default; no setup needed.

IDs are stable and prefix-typed, so you can always tell what an ID refers to.
Most commands take a workspace ID positionally and **infer it when the machine
has exactly one workspace**. Pass it explicitly once a second workspace exists.

## Preflight

```bash
yaak --version || npm install -g @yaakapp/cli
yaak workspace list
```

`workspace list` prints `wk_… - Name` per line, or `No workspaces found`. Pick
the workspace that matches the user's project before mutating anything; create
one only when nothing fits.

If a subcommand documented here is not recognized, the CLI is older than this
skill. Update it, then refresh the skill so the two stay in lockstep:

```bash
npm install -g @yaakapp/cli@latest && yaak agent install
```

Mention to the user that they need to restart their coding tool for the
refreshed skill to load; the current session keeps using the old copy.

## Command map

| Goal | Command |
|---|---|
| List | `yaak {workspace,folder,request,environment,cookie-jar} list` |
| Inspect one | `yaak {workspace,folder,request,environment} show <id>` |
| Create | `yaak {workspace,folder,request,environment} create` |
| Update | `yaak {workspace,folder,request,environment} update --json '{"id":"…",…}'` |
| Delete | `yaak … delete <id> --yes` |
| Inspect the model | `yaak request schema http --pretty`, `yaak workspace schema`, `yaak environment schema` |
| Send one request | `yaak request send <rq_id>` |
| Send a folder or whole workspace | `yaak send <fl_id\|wk_id>` |
| Import an existing API | `yaak import <file>` |
| Export | `yaak export <file> [workspace_id…]` |

Global flags go anywhere but are clearest before the subcommand:
`-e/--environment <ev_id>`, `--cookie-jar <cj_id>`, `-v/--verbose`,
`--data-dir <path>` (point at an isolated database, useful for scratch work).

## Creating and updating

Simple requests take flags:

```bash
yaak request create wk_abc123 --name "List Pets" --method GET --url "https://api.example.com/pets"
```

Anything richer than name/method/URL takes a JSON payload, either positionally
or via `--json`. **Read the schema before writing a payload you are unsure
of** — it is generated from the real model and includes the plugin-provided
authentication variants:

```bash
yaak request schema http --pretty
```

Rules that are easy to get wrong:

- **Setting `bodyType` does not add a `Content-Type` header.** The app adds one
  when you pick a body type in the UI, but creating a request from the CLI skips
  that step, and the body goes out untyped. Add the header yourself, using the
  same value as `bodyType` (with `other` → `text/plain` and `graphql` →
  `application/json`). Multipart is the exception: leave it alone, the sender
  supplies the boundary.
- **Path parameters must keep the leading colon.** For `/pets/:petId`, the
  `urlParameters` entry is named `:petId`, not `petId`. Get it wrong and the
  placeholder stays literal in the path while the value is appended to the query
  string, which usually 404s with no error.
- **Create** payloads must omit `id` (or set it to `""`).
- **Update** payloads must include `id`, and are applied as a JSON merge patch:
  keys you omit are left alone, and a key set to `null` is deleted. There is no
  need to send the whole object.
- Flags and JSON cannot be combined on the same command.
- `request create` and `request list` are HTTP-only. gRPC and WebSocket requests
  exist in the model and can be sent from the app, but the CLI cannot yet create
  or send them.

The first two fail silently, so verify a new request with `yaak -v request send
<id>` and check the `> ` lines actually show the path and headers you intended.

```bash
yaak request create wk_abc123 --json '{
  "name": "Create Pet", "method": "POST", "url": "${[ base_url ]}/pets",
  "bodyType": "application/json",
  "body": {"text": "{\"name\":\"Rex\"}"},
  "headers": [{"name": "Content-Type", "value": "application/json", "enabled": true}]
}'
```

See [requests.md](references/requests.md) for bodies, headers, authentication,
path parameters, and folder inheritance.

## Template variables

Yaak's template syntax is `${[ … ]}`, **not** `{{ … }}`. It works in URLs,
headers, bodies, and auth fields:

```
${[ base_url ]}/pets/${[ pet_id ]}
${[ response.body.path(request='rq_abc123', path='$.token') ]}
```

Referencing a variable that no active environment defines is a hard error and
the request is not sent, so an unresolved variable can never silently reach the
network. See [environments.md](references/environments.md) for variable scoping
and [chaining.md](references/chaining.md) for pulling values out of earlier
responses.

## Sending

```bash
yaak request send rq_abc123                       # body only, on stdout
yaak -e ev_staging request send rq_abc123         # against a sub-environment
yaak -v request send rq_abc123                    # request/response metadata too
yaak send fl_abc123 --fail-fast                   # every request in a folder
yaak send wk_abc123 --parallel                    # every request in a workspace
```

**Reading the result.** A plain send writes only the response body to stdout,
with no trailing newline. Like `curl`, the exit code reflects whether the
request completed, not the HTTP status — a 404 or 500 exits 0. Use `-v` when the
status matters:

```bash
yaak -v request send rq_abc123 2>&1 | grep '^< HTTP'
```

Under `-v`, connection/request/response lines (`*`, `>`, `<`) and the body all
go to stdout, with the body following the last `<` header line. Grep for the
prefixes you need rather than assuming a clean split.

Exit code 1 means the send itself failed: an unresolved template variable, an
unreachable host, a TLS failure. For folders and workspaces the last line is
`Send summary: N succeeded, M failed`, per-request errors follow on stderr, and
the exit code is 1 if any request failed.

## Running a suite in CI

Workspace and request IDs survive an export/import, so a committed export gives
a stable, runnable suite on a machine that has never seen the app:

```bash
npm install -g @yaakapp/cli
yaak --data-dir ./.yaak import ./api-export.json
yaak --data-dir ./.yaak -e ev_ci send wk_abc123 --fail-fast
```

`--data-dir` keeps the run isolated from any real Yaak install, and the IDs in
the export are the same ones you used locally. Produce the export with
`yaak export ./api-export.json wk_abc123`, adding
`--include-private-environments` only if the suite needs values you are willing
to commit — otherwise keep secrets in a CI-only environment and inject them.

**The caveat that matters here:** a failing *assertion* is not a concept Yaak
has, and HTTP error statuses do not fail the run. A workspace of requests that
all return 500 exits 0. The exit code catches unreachable hosts, TLS failures,
and unresolved variables only. To gate CI on status codes, run with `-v` and
check the `< HTTP` lines yourself. Say this plainly rather than implying a green
run means the API is healthy.

## Importing

`yaak import` auto-detects OpenAPI/Swagger, Postman, Insomnia, cURL, and Yaak
exports, and creates a new workspace by default:

```bash
yaak import ./openapi.yaml
yaak import ./collection.json --workspace-id wk_abc123   # merge into an existing one
```

This is almost always faster than authoring requests by hand when a spec exists.
See [import-export.md](references/import-export.md).

## Routing

| Task | Reference |
|---|---|
| Request bodies, headers, auth, path/query params, folder inheritance | [requests.md](references/requests.md) |
| Environment hierarchy, variables, per-environment runs | [environments.md](references/environments.md) |
| Using one response inside the next request; template functions | [chaining.md](references/chaining.md) |
| OpenAPI/Postman/Insomnia/cURL import, exporting workspaces | [import-export.md](references/import-export.md) |

## Execution rules

1. Resolve the workspace before mutating. Do not create a second workspace when
   an existing one matches the user's project.
2. Read the schema before writing a non-trivial JSON payload. Do not guess field
   names.
3. Prefer `update` merge patches over re-sending whole objects.
4. Deletes require `--yes` in a non-interactive shell; otherwise they block on a
   prompt. Confirm intent with the user before deleting anything.
5. Never write a real secret into an environment variable on the user's behalf.
   Reference one (`${[ api_token ]}`) and let the user fill in the value — see
   [environments.md](references/environments.md).
6. After creating requests, verify by sending one, and report the actual HTTP
   status from `-v` rather than inferring success from exit code 0.
7. Requests you create are permanent user data in their app, not scratch. Name
   them the way the user would, and clean up anything you created purely to test.
