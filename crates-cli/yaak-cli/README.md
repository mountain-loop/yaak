# yaak-cli

Command-line interface for Yaak.

## Command Overview

Current top-level commands:

```text
yaakcli send <request_id>
yaakcli workspace list
yaakcli workspace show <workspace_id>
yaakcli workspace create --name <name>
yaakcli workspace delete <workspace_id> [--yes]
yaakcli request list <workspace_id>
yaakcli request show <request_id>
yaakcli request send <request_id>
yaakcli request create <workspace_id> --name <name> --url <url> [--method GET]
yaakcli request delete <request_id> [--yes]
yaakcli folder list <workspace_id>
yaakcli folder show <folder_id>
yaakcli folder create <workspace_id> --name <name>
yaakcli folder delete <folder_id> [--yes]
yaakcli environment list <workspace_id>
yaakcli environment show <environment_id>
yaakcli environment create <workspace_id> --name <name>
yaakcli environment delete <environment_id> [--yes]
```

Global options:

- `--data-dir <path>`: use a custom data directory
- `-e, --environment <id>`: environment to use during request rendering/sending
- `-v, --verbose`: verbose logging and send output

Notes:

- `send` is currently a shortcut for sending an HTTP request ID.
- `delete` commands prompt for confirmation unless `--yes` is provided.
- In non-interactive mode, `delete` commands require `--yes`.

## Examples

```bash
yaakcli workspace list
yaakcli workspace create --name "My Workspace"
yaakcli workspace show wk_abc
yaakcli request list wk_abc
yaakcli request show rq_abc
yaakcli request create wk_abc --name "Users" --url "https://api.example.com/users"
yaakcli request send rq_abc -e ev_abc
yaakcli request delete rq_abc --yes
yaakcli folder create wk_abc --name "Auth"
yaakcli environment create wk_abc --name "Production"
```

## Roadmap

Planned command expansion (JSON create/update, request schema, and polymorphic send) is tracked in `PLAN.md`.

When command behavior changes, update this README and verify with:

```bash
cargo run -q -p yaak-cli -- --help
cargo run -q -p yaak-cli -- request --help
cargo run -q -p yaak-cli -- workspace --help
cargo run -q -p yaak-cli -- folder --help
cargo run -q -p yaak-cli -- environment --help
```
