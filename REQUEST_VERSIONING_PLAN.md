# Request versioning (IntelliJ Local History style)

Working plan for `feat/request-versioning`. Tracks
[save-request-data-for-response-history](https://yaak.app/feedback/posts/save-request-data-for-response-history).

Selecting an old response should be able to show, and restore, the request that produced it.

## Model

One table, `model_versions`, versions every request type:

| column | meaning |
| --- | --- |
| `id`, `model`, `created_at`, `updated_at` | usual model columns |
| `workspace_id` | owning workspace |
| `model_type` | `http_request` / `grpc_request` / `websocket_request` |
| `model_id` | the request the version belongs to |
| `content_hash` | sha256 of the canonical document |
| `document` | JSON of the request's editable content |
| `reason` | `send` / `switch` / `idle` / `restore` / `manual` |

`http_responses`, `grpc_connections` and `websocket_connections` each gain a nullable
`version_id`.

A version's `document` is the model's JSON with bookkeeping keys removed — `model`, `id`,
`createdAt`, `updatedAt`, `workspaceId`, `folderId`, `sortPriority`. One rule, applied the same
way to all three request types; the hash is taken over exactly what the document holds, so moving
a request between folders or re-sorting it never mints a version.

`(model_id, content_hash)` is unique, so dedup is the database's job rather than a code path that
can be forgotten. Sending an unchanged request ten times leaves one version and ten responses
pointing at it.

## Snapshot

One primitive, `ClientDb::snapshot_request(request, reason)`: build the document, hash it, return
the existing row for that hash or insert a new one, then prune. Everything calls it.

- **Sends.** `resolve_send_inputs` (HTTP, every host — desktop, CLI, plugin-triggered) snapshots
  before the response row is created, and the resulting id rides down to the response.
  gRPC and WebSocket connect paths do the same at their own connection upserts.
- **Edit-session boundaries the frontend can see**, all through one RPC: switching to another
  request, window blur, app close, and a 60s idle timer after the last edit.

Over-triggering is free, so the trigger code stays dumb.

## Restore

`restore_request_version(version_id)`:

1. Snapshot the live request (reason `restore`), so anything newer than its last version is kept.
2. Merge the version's document over the live model, keeping bookkeeping fields.
3. Upsert. The written content's hash already exists, so no new version row appears.

The frontend calls `wasUpdatedExternally` afterwards so open editors reload.

## Retention

An unreferenced version survives only while it is among the newest 50 for its request *and* newer
than 30 days. A version referenced by a response lives as long as that response. Deleting a
request deletes its versions. Versions are local history: not synced to the filesystem, not in
Git, not exported.

## UI (v1, HTTP)

When the selected response's version differs from the live request, the response header grows a
state-labelled dropdown ("Request Changed", following the GraphQL editor's pattern) with **View
Diff** and **Restore**. The diff reuses the Git dialog's `DiffViewer` over YAML renderings of the
two documents. No versions timeline panel in v1; gRPC and WebSocket are wired on the backend from
day one and their UI can follow.

## Status

- [x] Migration + `ModelVersion` model + bindings
- [x] Hashing / document extraction, with tests
- [x] Queries: snapshot, prune, restore, cascade
- [x] Send pipelines: HTTP, gRPC, WebSocket (plus the browser host's own)
- [x] RPC commands + web/wasm host
- [x] Frontend: snapshot triggers, dropdown, diff dialog, restore

## Deliberately not in v1

- **No versions timeline panel.** The only entry point is a response, which is
  what the feedback asked for. A "browse all versions of this request" view is a
  second feature on the same data and can land later without a schema change.
- **No gRPC or WebSocket UI.** Both record versions from day one, so the history
  is accumulating; only the indicator is HTTP-only.
- **No `manual` trigger.** The reason exists so that adding a "Save version now"
  action later is a UI change and not a migration.
- **Folders, environments and workspaces are not versioned.** The response
  timeline already records what a send inherited from them.

## Notes for later

- The version's `document` is the model minus bookkeeping keys, so a restore
  merges over the live model and a field added after a version was captured
  keeps its live value rather than being blanked.
- `content_hash` sorts object keys before hashing. Relying on
  `serde_json::Map` being a `BTreeMap` is not safe: `preserve_order` is on in
  some builds of this workspace and off in others, which is exactly the bug the
  `key_order_does_not_change_the_hash` test caught.
