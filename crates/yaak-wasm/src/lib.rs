//! The desktop's model layer, running in a browser.
//!
//! Nothing here is model logic. This crate registers a persistent VFS, opens
//! the database through the same `init_standalone` the CLI uses, and answers
//! the `models_*` commands by calling the same `ClientDb` queries the desktop
//! does. A browser tab therefore stores exactly what a desktop install stores,
//! migrations and all — the only thing that differs is where the SQLite pages
//! live (IndexedDB) and who is calling in (a worker instead of Tauri).
//!
//! It is meant to be loaded once, in one place — a SharedWorker — because two
//! SQLite instances over the same IndexedDB pages would corrupt them. The
//! JavaScript side owns that; this crate assumes it is the only writer.
//!
//! The command surface is deliberately narrow: what the frontend needs to keep
//! its model store coherent, blob storage, and the "prepare" half of a send
//! (resolve, inherit, render — see [`prepare_http_send`]). Putting bytes on the
//! network, plugins, git, sync and everything else with a socket or a
//! filesystem behind it lives elsewhere.

// Nothing in here means anything off wasm32, and building it there would drag
// SQLite's wasm C shim into a native compile. So on any other target the crate
// is empty — a workspace-wide `cargo test` passes through it.
#![cfg(target_arch = "wasm32")]

use std::cell::RefCell;
use std::sync::mpsc;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;
use yaak_models::blob_manager::{BlobManager, BodyChunk};
use yaak_models::cookies::apply_cookie_changes;
use yaak_models::models::{
    AnyModel, Cookie, CookieJar, HttpRequest, HttpResponseEvent, HttpResponseEventData,
    HttpSendSettings,
};
use yaak_models::models_ops;
use yaak_models::query_manager::QueryManager;
use yaak_models::render::render_http_request;
use yaak_models::util::{ModelPayload, UpdateSource};
use yaak_templates::{RenderOptions, TemplateCallback};

/// Names inside the VFS, not paths on any disk. Two files because the desktop
/// keeps two: models in one, blobs in the other.
const DB_NAME: &str = "yaak.db";
const BLOB_DB_NAME: &str = "yaak-blobs.db";
const VFS_NAME: &str = "yaak-idb";

struct Host {
    queries: QueryManager,
    blobs: BlobManager,
    events: mpsc::Receiver<ModelPayload>,
}

fn lifecycle_host() -> yaak_lifecycle::Host {
    yaak_lifecycle::Host::owner()
}

thread_local! {
    static HOST: RefCell<Option<Host>> = const { RefCell::new(None) };
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/// What a failed command hands back to JavaScript: a real `Error`, so it
/// throws like one, with `message` set to the model layer's own text.
fn js_error(e: impl std::fmt::Display) -> JsValue {
    js_sys::Error::new(&e.to_string()).into()
}

type Result<T> = std::result::Result<T, JsValue>;

/* -------------------------------------------------------------------------- */
/* Boot                                                                        */
/* -------------------------------------------------------------------------- */

/// Register the IndexedDB-backed VFS and open the database.
///
/// Migrations run inside `init_standalone`, exactly as they do for the CLI.
/// Safe to call more than once; later calls are no-ops.
#[wasm_bindgen]
pub async fn boot() -> Result<()> {
    console_error_panic_hook::set_once();

    if HOST.with(|h| h.borrow().is_some()) {
        return Ok(());
    }

    // "Relaxed" means writes land in memory first and are flushed to
    // IndexedDB shortly after, rather than on every commit. It is the right
    // trade for a client app: a tab closing mid-flush loses at most the last
    // few writes, and the alternative (OPFS sync access handles) needs a
    // dedicated worker per file and is not available everywhere.
    let cfg = sqlite_wasm_vfs::relaxed_idb::RelaxedIdbCfgBuilder::new()
        .vfs_name(VFS_NAME)
        .preload(sqlite_wasm_vfs::relaxed_idb::Preload::All)
        .build();
    sqlite_wasm_vfs::relaxed_idb::install::<sqlite_wasm_rs::WasmOsCallback>(&cfg, true)
        .await
        .map_err(js_error)?;

    let (queries, blobs, events) =
        yaak_models::init_standalone(DB_NAME, BLOB_DB_NAME).map_err(js_error)?;

    if let Err(e) = yaak_lifecycle::on_launch(&lifecycle_host(), &queries.connect(), &blobs) {
        web_sys::console::warn_2(&"on_launch hook failed".into(), &js_error(e));
    }

    HOST.with(|h| *h.borrow_mut() = Some(Host { queries, blobs, events }));
    Ok(())
}

fn with_host<T>(f: impl FnOnce(&Host) -> Result<T>) -> Result<T> {
    HOST.with(|h| {
        let h = h.borrow();
        let host = h.as_ref().ok_or_else(|| js_error("yaak-web: call boot() before rpc()"))?;
        f(host)
    })
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                    */
/* -------------------------------------------------------------------------- */

/// A command's outcome, plus every model write it caused.
///
/// The writes ride along with the result rather than being fetched separately
/// so the caller can announce them atomically with completion — a tab that
/// awaits `models_upsert` must see its echo before or with the response, never
/// after, or the store races the reply.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcOutcome {
    result: serde_json::Value,
    events: Vec<ModelPayload>,
}

/// Run one command as `label` (the calling tab's identity, which stands in for
/// the desktop's window label on every write it makes).
///
/// The payload shapes match the `Cmd*Req` types in `yaak-rpc-schema`, but are
/// declared locally and dispatched by name, which is the one place this host
/// does not share the desktop's guarantees: the desktop builds its router from
/// the schema, so every command has a handler by construction. Here a renamed
/// command would surface as a runtime "not a command this host answers".
///
/// The fix is `yaak-commands` (the `Host` trait), not more machinery here —
/// its `models::*` handlers are already this file, typed. Three things have to
/// give before a wasm host can register them:
///
/// 1. `Host: Send + Sync`, which a browser cannot satisfy: there is one thread
///    and the connection pool is an `Rc`.
/// 2. `models_delete` reaches for `spawn_blocking`; there is nothing to spawn
///    onto here.
/// 3. `yaak-commands` depends on `yaak` and `yaak-plugins`, which pull the HTTP
///    stack and the Node sidecar and do not build for wasm32.
///
/// None of those are hard; they are just not this PR.
#[wasm_bindgen]
pub fn rpc(cmd: &str, payload: JsValue, label: &str) -> Result<JsValue> {
    let source = UpdateSource::from_window_label(label);

    let result = with_host(|host| dispatch(host, cmd, payload, &source))?;
    let events = with_host(|host| Ok(host.events.try_iter().collect::<Vec<_>>()))?;

    use serde::Serialize as _;
    RpcOutcome { result, events }
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(js_error)
}

fn from_js<T: for<'de> Deserialize<'de>>(payload: JsValue) -> Result<T> {
    serde_wasm_bindgen::from_value(payload).map_err(js_error)
}

fn to_json<T: Serialize>(value: T) -> Result<serde_json::Value> {
    serde_json::to_value(value).map_err(js_error)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceModelsReq {
    workspace_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelReq {
    model: AnyModel,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DuplicateReq {
    model_type: String,
    model_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceIdReq {
    workspace_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestIdReq {
    request_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertIntrospectionReq {
    workspace_id: String,
    request_id: String,
    content: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResponseIdReq {
    response_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistSendCookiesReq {
    cookie_jar_id: String,
    before: Vec<Cookie>,
    after: Vec<Cookie>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InsertResponseEventsReq {
    response_id: String,
    workspace_id: String,
    events: Vec<HttpResponseEventData>,
}

fn dispatch(
    host: &Host,
    cmd: &str,
    payload: JsValue,
    source: &UpdateSource,
) -> Result<serde_json::Value> {
    match cmd {
        // The one big read. Same list, same order, and the same four lazy
        // creates (settings, first workspace, cookie jar, base environment) as
        // `models_workspace_models` on the desktop — this call is where an
        // empty database becomes a usable one. Returned as a JSON *string*
        // because that is what the desktop returns and what the store parses.
        "models_workspace_models" => {
            let req: WorkspaceModelsReq = from_js(payload)?;
            let db = host.queries.connect();
            let mut list: Vec<AnyModel> = Vec::new();

            list.push(db.get_settings().into());
            list.extend(db.list_workspaces().map_err(js_error)?.into_iter().map(Into::into));
            list.extend(db.list_key_values().map_err(js_error)?.into_iter().map(Into::into));
            // No plugin runtime to resolve these against; the rows are still
            // the truth about what is installed.
            list.extend(db.list_plugins().map_err(js_error)?.into_iter().map(Into::into));

            if let Some(wid) = req.workspace_id.as_deref() {
                let e = js_error;
                list.extend(db.list_cookie_jars(wid).map_err(e)?.into_iter().map(Into::into));
                list.extend(
                    db.list_environments_ensure_base(wid).map_err(e)?.into_iter().map(Into::into),
                );
                list.extend(db.list_folders(wid).map_err(e)?.into_iter().map(Into::into));
                list.extend(db.list_grpc_connections(wid).map_err(e)?.into_iter().map(Into::into));
                list.extend(db.list_grpc_requests(wid).map_err(e)?.into_iter().map(Into::into));
                list.extend(db.list_http_requests(wid).map_err(e)?.into_iter().map(Into::into));
                list.extend(
                    db.list_http_responses(wid, None).map_err(e)?.into_iter().map(Into::into),
                );
                list.extend(
                    db.list_websocket_connections(wid).map_err(e)?.into_iter().map(Into::into),
                );
                list.extend(
                    db.list_websocket_requests(wid).map_err(e)?.into_iter().map(Into::into),
                );
                list.extend(db.list_workspace_metas(wid).map_err(e)?.into_iter().map(Into::into));
            }

            to_json(serde_json::to_string(&list).map_err(js_error)?)
        }

        "models_upsert" => {
            let req: ModelReq = from_js(payload)?;
            let db = host.queries.connect();
            let id =
                models_ops::upsert_model(&db, &host.blobs, req.model, source).map_err(js_error)?;
            to_json(id)
        }

        // Deletes and duplicates cascade, so they run in a transaction, as on
        // the desktop.
        "models_delete" => {
            let req: ModelReq = from_js(payload)?;
            let id = host
                .queries
                .with_tx(|tx| models_ops::delete_model(tx, &host.blobs, req.model, source))
                .map_err(js_error)?;
            to_json(id)
        }

        "models_duplicate" => {
            let req: DuplicateReq = from_js(payload)?;
            let id = host
                .queries
                .with_tx(|tx| {
                    models_ops::duplicate_model(tx, &req.model_type, &req.model_id, source)
                })
                .map_err(js_error)?;
            to_json(id)
        }

        "models_get_settings" => to_json(host.queries.connect().get_settings()),

        "models_get_graphql_introspection" => {
            let req: RequestIdReq = from_js(payload)?;
            to_json(host.queries.connect().get_graphql_introspection(&req.request_id))
        }

        "models_upsert_graphql_introspection" => {
            let req: UpsertIntrospectionReq = from_js(payload)?;
            let saved = host
                .queries
                .connect()
                .upsert_graphql_introspection(
                    &req.workspace_id,
                    &req.request_id,
                    req.content,
                    source,
                )
                .map_err(js_error)?;
            to_json(saved)
        }

        // Nothing here can open a socket, so no connection ever produced any.
        "models_grpc_events" | "models_websocket_events" => to_json(Vec::<()>::new()),

        "web_get_http_request" => {
            let req: RequestIdReq = from_js(payload)?;
            to_json(host.queries.connect().get_http_request(&req.request_id).map_err(js_error)?)
        }

        "cmd_get_http_response_events" => {
            let req: ResponseIdReq = from_js(payload)?;
            to_json(
                host.queries
                    .connect()
                    .list_http_response_events(&req.response_id)
                    .map_err(js_error)?,
            )
        }

        // The cookies a send set or cleared, applied to the jar as it is *now* rather than
        // written over it, so an edit made while the send was in flight survives.
        "web_persist_send_cookies" => {
            let req: PersistSendCookiesReq = from_js(payload)?;
            if req.before == req.after {
                return to_json(());
            }
            let db = host.queries.connect();
            let jar = db.get_cookie_jar(&req.cookie_jar_id).map_err(js_error)?;
            let cookies = apply_cookie_changes(jar.cookies.clone(), &req.before, &req.after);
            db.upsert_cookie_jar(&CookieJar { cookies, ..jar }, source).map_err(js_error)?;
            to_json(())
        }

        // The tab's half of the send timeline: the events the proxy streamed back, recorded
        // under the response they belong to. Same rows the desktop's send task writes, and the
        // writes fan out to every tab as `model_writes` like any other.
        "web_insert_http_response_events" => {
            let req: InsertResponseEventsReq = from_js(payload)?;
            let db = host.queries.connect();
            for event in req.events {
                let model = HttpResponseEvent::new(&req.response_id, &req.workspace_id, event);
                db.upsert_http_response_event(&model, source).map_err(js_error)?;
            }
            to_json(())
        }

        "cmd_get_workspace_meta" => {
            let req: WorkspaceIdReq = from_js(payload)?;
            let db = host.queries.connect();
            let workspace = db.get_workspace(&req.workspace_id).map_err(js_error)?;
            to_json(db.get_or_create_workspace_meta(&workspace.id).map_err(js_error)?)
        }

        "cmd_delete_all_http_responses" => {
            let req: RequestIdReq = from_js(payload)?;
            host.queries
                .connect()
                .delete_all_http_responses_for_request(&req.request_id, source)
                .map_err(js_error)?;
            to_json(())
        }

        "cmd_delete_send_history" => {
            let req: WorkspaceIdReq = from_js(payload)?;
            host.queries
                .with_tx(|tx| {
                    tx.delete_all_http_responses_for_workspace(&req.workspace_id, source)?;
                    tx.delete_all_grpc_connections_for_workspace(&req.workspace_id, source)?;
                    tx.delete_all_websocket_connections_for_workspace(&req.workspace_id, source)?;
                    Ok::<(), yaak_models::error::Error>(())
                })
                .map_err(js_error)?;
            to_json(())
        }

        other => Err(js_error(format!("yaak-web: `{other}` is not a command this host answers"))),
    }
}

/* -------------------------------------------------------------------------- */
/* Preparing a send                                                            */
/* -------------------------------------------------------------------------- */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrepareHttpSendReq {
    request_id: String,
    environment_id: Option<String>,
    cookie_jar_id: Option<String>,
}

/// Everything a send needs that lives in the database, resolved and rendered: the desktop's
/// `HttpSendInputs`, in the shape a tab hands to the proxy and keeps for itself.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreparedHttpSend {
    /// The request with inherited headers and authentication applied and every template
    /// rendered. What the proxy sends, and what the response records as its request.
    request: HttpRequest,
    settings: HttpSendSettings,
    /// The `* Setting name=value` timeline lines the desktop writes at the top of a send,
    /// sources and all. The tab records them before the proxy's own events.
    setting_events: Vec<HttpResponseEventData>,
    /// The jar the send starts with, so the tab can write it back with the proxy's changes.
    cookie_jar: Option<CookieJar>,
}

/// A template callback for a host with no plugins. Variables render; a function is a clear
/// refusal naming the function, so the user knows what the request needs rather than seeing
/// an empty string sent in its place.
struct NoPluginsCallback;

impl TemplateCallback for NoPluginsCallback {
    fn run(
        &self,
        fn_name: &str,
        _args: HashMap<String, serde_json::Value>,
    ) -> impl std::future::Future<Output = yaak_templates::error::Result<String>> + Send {
        let message = format!(
            "This request uses the template function \"{fn_name}\", which needs plugins. \
             Plugins aren't available in the browser yet"
        );
        async move { Err(yaak_templates::error::Error::RenderError(message)) }
    }

    fn transform_arg(
        &self,
        _fn_name: &str,
        _arg_name: &str,
        arg_value: &str,
    ) -> yaak_templates::error::Result<String> {
        Ok(arg_value.to_string())
    }
}

/// Resolve and render a request for sending, exactly as the desktop does before it puts the
/// request on the network: the environment chain, inherited headers and auth, request
/// settings, the cookie jar. Nothing here touches a socket. What comes back is what the tab
/// posts to the Yaak server.
///
/// Refuses, with a message the user can act on, when the request needs something this host
/// doesn't have: an authentication plugin, or a template function.
#[wasm_bindgen]
pub async fn prepare_http_send(payload: JsValue) -> Result<JsValue> {
    let req: PrepareHttpSendReq = from_js(payload)?;

    // Everything from the database first, then release the host borrow before rendering.
    let (request, environment_chain, settings, cookie_jar) = with_host(|host| {
        let db = host.queries.connect();
        let request = db.get_http_request(&req.request_id).map_err(js_error)?;
        let environment_chain = db
            .resolve_environments(
                &request.workspace_id,
                request.folder_id.as_deref(),
                req.environment_id.as_deref(),
            )
            .map_err(js_error)?;
        let (authentication_type, authentication, _auth_context_id) =
            db.resolve_auth_for_http_request(&request).map_err(js_error)?;
        let headers = db.resolve_headers_for_http_request(&request).map_err(js_error)?;
        let settings = db.resolve_settings_for_http_request(&request).map_err(js_error)?;
        let cookie_jar = match req.cookie_jar_id.as_deref() {
            Some(id) => Some(db.get_cookie_jar(id).map_err(js_error)?),
            None => None,
        };
        let request = HttpRequest { authentication_type, authentication, headers, ..request };
        Ok((request, environment_chain, settings, cookie_jar))
    })?;

    let rendered = render_http_request(
        &request,
        environment_chain,
        &NoPluginsCallback,
        &RenderOptions::throw(),
    )
    .await
    .map_err(js_error)?;

    // Authentication is applied by a plugin on the desktop. There is no plugin here, and a
    // request sent without the auth it asked for is worse than one refused with the reason.
    let auth_disabled =
        rendered.authentication.get("disabled").and_then(|v| v.as_bool()) == Some(true);
    if let Some(auth_type) = rendered.authentication_type.as_deref()
        && auth_type != "none"
        && !auth_disabled
    {
        return Err(js_error(format!(
            "This request uses {auth_type} authentication, which needs plugins. \
             Plugins aren't available in the browser yet"
        )));
    }

    let prepared = PreparedHttpSend {
        request: rendered,
        settings: HttpSendSettings::from(&settings),
        setting_events: settings.timeline_events(),
        cookie_jar,
    };
    // JSON-compatible, as `rpc` does: the tab posts this to the proxy with `JSON.stringify`,
    // and the default serializer's `Map` for the request body would stringify to `{}`.
    use serde::Serialize as _;
    prepared.serialize(&serde_wasm_bindgen::Serializer::json_compatible()).map_err(js_error)
}

/* -------------------------------------------------------------------------- */
/* Blobs                                                                       */
/* -------------------------------------------------------------------------- */

/// The bytes stored under an id, or none. Ids are the desktop's: a response's
/// own id for its body, `{responseId}.request` for the request that produced
/// it. Bytes cross to JS as a `Uint8Array` rather than through JSON.
#[wasm_bindgen]
pub fn blob_get(id: &str) -> Result<Option<Vec<u8>>> {
    with_host(|host| {
        let chunks = host.blobs.connect().get_chunks(id).map_err(js_error)?;
        if chunks.is_empty() {
            return Ok(None);
        }
        Ok(Some(chunks.into_iter().flat_map(|c| c.data).collect()))
    })
}

/// Store bytes under an id, replacing anything already there. Chunked the way
/// the desktop chunks, so a body written here reads back on a desktop that
/// imports the database, and vice versa.
#[wasm_bindgen]
pub fn blob_put(id: &str, bytes: &[u8]) -> Result<()> {
    const CHUNK: usize = 512 * 1024;
    with_host(|host| {
        let ctx = host.blobs.connect();
        ctx.delete_chunks(id).map_err(js_error)?;
        for (i, part) in bytes.chunks(CHUNK).enumerate() {
            ctx.insert_chunk(&BodyChunk::new(id, i as i32, part.to_vec())).map_err(js_error)?;
        }
        Ok(())
    })
}

#[wasm_bindgen]
pub fn blob_delete(id: &str) -> Result<()> {
    with_host(|host| host.blobs.connect().delete_chunks(id).map_err(js_error))
}
