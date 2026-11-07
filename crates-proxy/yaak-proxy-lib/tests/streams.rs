//! Streaming flows through a running engine: server-sent events and gRPC-Web over plain
//! HTTP, stored as messages while they stream, and gRPC messages decoded with and without a
//! schema.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::Path;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use bytes::Bytes;
use http_body_util::combinators::UnsyncBoxBody;
use http_body_util::{BodyExt, Full, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto;
use serde_json::{Value, json};
use tokio::net::TcpListener;
use yaak_proxy_lib::bodies::read_raw_body;
use yaak_proxy_lib::models::{Flow, FlowBody};
use yaak_proxy_lib::settings::ProxySettings;
use yaak_proxy_lib::{GrpcConfig, MasterKeySource, ProxyCtx};
use yaak_rpc::RpcEventEmitter;

type BoxError = Box<dyn std::error::Error + Send + Sync>;
type TestBody = UnsyncBoxBody<Bytes, BoxError>;

const PROTO: &str = r#"
syntax = "proto3";
package pkg;
service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
}
message HelloRequest { string name = 1; }
message HelloReply { string message = 1; int32 count = 2; }
"#;

/// The longest a test here may run: one that hangs fails with a message instead of holding CI
/// until its job is cancelled.
const TEST_TIMEOUT: Duration = Duration::from_secs(60);

async fn within<T>(test: impl Future<Output = T>) -> T {
    match tokio::time::timeout(TEST_TIMEOUT, test).await {
        Ok(result) => result,
        Err(_) => panic!("the test did not finish within {TEST_TIMEOUT:?}"),
    }
}

fn full(data: impl Into<Bytes>) -> TestBody {
    Full::new(data.into()).map_err(|never| match never {}).boxed_unsync()
}

fn grpc_frame(flag: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = vec![flag];
    out.extend((payload.len() as u32).to_be_bytes());
    out.extend(payload);
    out
}

/// A protobuf message with a string in field 1, and a varint in field 2 when given.
fn proto(text: &str, count: Option<u8>) -> Vec<u8> {
    let mut out = vec![0x0a, text.len() as u8];
    out.extend(text.as_bytes());
    if let Some(count) = count {
        out.extend([0x10, count]);
    }
    out
}

fn protoc() -> GrpcConfig {
    GrpcConfig {
        protoc_bin_path: protoc_bin_vendored::protoc_bin_path().unwrap(),
        protoc_include_dir: protoc_bin_vendored::include_path().unwrap(),
    }
}

fn proto_file(dir: &Path) -> String {
    let path = dir.join("greeter.proto");
    std::fs::write(&path, PROTO).unwrap();
    path.to_string_lossy().into_owned()
}

type ReflectionFuture = std::pin::Pin<Box<dyn Future<Output = Response<tonic::body::Body>> + Send>>;
/// A gRPC reflection service, its type erased.
type Reflection =
    std::sync::Arc<dyn Fn(Request<tonic::body::Body>) -> ReflectionFuture + Send + Sync>;

fn reflection_service<S>(service: S) -> Reflection
where
    S: tonic::codegen::Service<
            Request<tonic::body::Body>,
            Response = Response<tonic::body::Body>,
            Error = Infallible,
        > + Clone
        + Send
        + Sync
        + 'static,
    S::Future: Send,
{
    std::sync::Arc::new(move |req| {
        let mut service = service.clone();
        Box::pin(async move {
            std::future::poll_fn(|cx| service.poll_ready(cx)).await.unwrap();
            service.call(req).await.unwrap()
        })
    })
}

/// Serves the upstream's routes, and gRPC reflection for `pkg.Greeter` over HTTP/2 when given
/// one.
async fn route(
    req: Request<Incoming>,
    reflection: Option<Reflection>,
) -> Result<Response<TestBody>, Infallible> {
    let path = req.uri().path().to_string();
    if path.starts_with("/grpc.reflection.v1.ServerReflection/") {
        let Some(reflection) = reflection else {
            return Ok(Response::builder().status(404).body(full("")).unwrap());
        };
        let resp = reflection(req.map(tonic::body::Body::new)).await;
        return Ok(resp.map(|b| b.map_err(|e| Box::new(e) as BoxError).boxed_unsync()));
    }
    Ok(match path.as_str() {
        // Two events a while apart, so the first is stored while the stream is open.
        "/events" => {
            let frames = futures_util::stream::unfold(0, |i| async move {
                let chunk = match i {
                    0 => "event: tick\nid: 1\ndata: first\n\n",
                    1 => {
                        tokio::time::sleep(Duration::from_millis(1500)).await;
                        "data: second\n\n"
                    }
                    _ => return None,
                };
                Some((Ok::<_, BoxError>(Frame::data(Bytes::from(chunk))), i + 1))
            });
            Response::builder()
                .header("content-type", "text/event-stream")
                .body(StreamBody::new(frames).boxed_unsync())
                .unwrap()
        }
        "/pkg.Greeter/SayHello" => {
            let body = req.into_body().collect().await.unwrap().to_bytes();
            let name = String::from_utf8_lossy(&body[7..]).into_owned();
            let mut out = grpc_frame(0, &proto(&format!("Hello {name}"), Some(3)));
            out.extend(grpc_frame(0x80, b"grpc-status: 0\r\n"));
            Response::builder()
                .header("content-type", "application/grpc-web+proto")
                .body(full(out))
                .unwrap()
        }
        // A whole reply, then half of one, and the connection gives out.
        "/pkg.Greeter/Cut" => {
            let mut first = grpc_frame(0, &proto("whole", None));
            first.extend(&grpc_frame(0, &proto("half of it", None))[..9]);
            let frames = futures_util::stream::unfold(Some(first), |first| async move {
                match first {
                    Some(first) => Some((Ok::<_, BoxError>(Frame::data(Bytes::from(first))), None)),
                    // After the bytes have gone out
                    None => {
                        tokio::time::sleep(Duration::from_millis(200)).await;
                        Some((Err("connection reset".into()), None))
                    }
                }
            });
            Response::builder()
                .header("content-type", "application/grpc-web+proto")
                .body(StreamBody::new(frames).boxed_unsync())
                .unwrap()
        }
        "/pkg.Down/Call" => Response::builder()
            .status(502)
            .header("content-type", "text/plain")
            .body(full("upstream down"))
            .unwrap(),
        _ => Response::builder()
            .header("content-type", "application/grpc-web+proto")
            .body(full(grpc_frame(0x80, b"grpc-status: 12\r\ngrpc-message: not%20here\r\n")))
            .unwrap(),
    })
}

async fn spawn_upstream(reflection: Option<Reflection>) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (tcp, _) = listener.accept().await.unwrap();
            let reflection = reflection.clone();
            tokio::spawn(async move {
                let svc = service_fn(move |req| route(req, reflection.clone()));
                let _ = auto::Builder::new(TokioExecutor::new())
                    .serve_connection(TokioIo::new(tcp), svc)
                    .await;
            });
        }
    });
    addr
}

fn start(dir: &Path) -> (ProxyCtx, std::sync::mpsc::Receiver<yaak_rpc::RpcEvent>) {
    let settings = ProxySettings {
        port: 0,
        capture_body_limit: 1024 * 1024,
        system_proxy_at_launch: false,
        ..Default::default()
    };
    settings.save(&dir.join("settings.json")).unwrap();
    let (events, event_rx) = RpcEventEmitter::new();
    let ctx = ProxyCtx::new(dir, events, MasterKeySource::memory()).unwrap().with_protoc(protoc());
    ctx.start().unwrap();
    (ctx, event_rx)
}

fn client(ctx: &ProxyCtx) -> reqwest::Client {
    let proxy = format!("http://127.0.0.1:{}", ctx.port().unwrap());
    reqwest::Client::builder().proxy(reqwest::Proxy::all(proxy).unwrap()).build().unwrap()
}

async fn rpc(ctx: &ProxyCtx, cmd: &str, payload: Value) -> Result<Value, String> {
    yaak_proxy_lib::build_router().dispatch(cmd, payload, ctx).await.map_err(|e| e.message)
}

/// Waits until `check` holds for the flow of `url`, as stored.
async fn wait_for(ctx: &ProxyCtx, url: &str, check: impl Fn(&Flow) -> bool) -> Flow {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let flows = ctx.db().with_conn(|db| db.find_all::<Flow>().unwrap());
        if let Some(flow) = flows.into_iter().find(|f| f.url == url && check(f)) {
            return flow;
        }
        assert!(Instant::now() < deadline, "no flow for {url} as expected");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn server_sent_events_are_stored_while_the_stream_is_open() {
    within(async {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, event_rx) = start(dir.path());
        let upstream = spawn_upstream(None).await;
        let url = format!("http://{upstream}/events");
        let reading = tokio::spawn({
            let client = client(&ctx);
            let url = url.clone();
            async move { client.get(&url).send().await.unwrap().text().await.unwrap() }
        });

        // The flow is in the database with its first event while the second is still to come.
        let open = wait_for(&ctx, &url, |f| f.message_count == 1).await;
        assert_eq!(open.stream_kind.map(|k| k.as_str()), Some("sse"));
        assert_eq!(open.elapsed_ms, None, "still streaming");
        let listed = rpc(&ctx, "list_messages", json!({ "flowId": open.id })).await.unwrap();
        assert_eq!(listed["total"], 1);
        let first = &listed["messages"][0];
        assert_eq!(
            (first["kind"].as_str(), first["direction"].as_str()),
            (Some("sse_event"), Some("server"))
        );
        assert_eq!(first["preview"], "first");
        assert_eq!(
            first["meta"],
            json!({ "event": "tick", "eventId": "1", "raw": "event: tick\nid: 1\ndata: first\n\n" })
        );

        assert_eq!(reading.await.unwrap(), "event: tick\nid: 1\ndata: first\n\ndata: second\n\n");
        let ended = wait_for(&ctx, &url, |f| f.elapsed_ms.is_some()).await;
        assert_eq!((ended.message_count, ended.error), (2, None));
        let after =
            rpc(&ctx, "list_messages", json!({ "flowId": ended.id, "afterSeq": 0 })).await.unwrap();
        assert_eq!(after["messages"].as_array().unwrap().len(), 1);
        let payload = rpc(&ctx, "get_message_payload", json!({ "flowId": ended.id, "seq": 1 }))
            .await
            .unwrap();
        assert_eq!(payload["data"], "c2Vjb25k", "\"second\" in base64");

        // The events are the body's record: nothing of it went to the blob store, and it reads
        // back as the client read it.
        assert!(read_raw_body(&ctx.blobs(), &ended.id, FlowBody::Response).unwrap().is_empty());
        let body = rpc(&ctx, "get_flow_body", json!({ "flowId": ended.id, "which": "response" }))
            .await
            .unwrap();
        let sent = "event: tick\nid: 1\ndata: first\n\ndata: second\n\n";
        assert_eq!(body["data"], BASE64.encode(sent));
        assert_eq!(
            (body["truncated"].as_bool(), body["storedSize"].as_u64()),
            (Some(false), Some(sent.len() as u64))
        );
        let path = dir.path().join("events.txt");
        let saved = rpc(
            &ctx,
            "save_flow_body",
            json!({ "flowId": ended.id, "which": "response", "path": path }),
        )
        .await
        .unwrap();
        assert_eq!(saved["raw"], false);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), sent);

        // The app heard of the open flow, of each message, and of the end.
        let events: Vec<_> = event_rx.try_iter().map(|e| e.event).collect();
        let writes = |name: &str| events.iter().filter(|e| **e == name).count();
        assert_eq!(writes("message_write"), 2, "{events:?}");
        assert!(writes("model_write") >= 2, "{events:?}");
    })
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn grpc_web_calls_are_stored_and_decoded() {
    within(async {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, _event_rx) = start(dir.path());
        let upstream = spawn_upstream(None).await;
        let client = client(&ctx);

        let url = format!("http://{upstream}/pkg.Greeter/SayHello");
        let body = client
            .post(&url)
            .header("content-type", "application/grpc-web+proto")
            .body(grpc_frame(0, &proto("Ada", None)))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        assert!(body.starts_with(&grpc_frame(0, &proto("Hello Ada", Some(3)))));
        let flow = wait_for(&ctx, &url, |f| f.elapsed_ms.is_some()).await;
        assert_eq!(flow.stream_kind.map(|k| k.as_str()), Some("grpc_web"));
        assert_eq!(
            (flow.grpc_service.as_deref(), flow.grpc_method.as_deref()),
            (Some("pkg.Greeter"), Some("SayHello"))
        );
        assert_eq!((flow.grpc_status, flow.message_count), (Some(0), 3));
        // Both bodies are the call's messages, read back framed as they were sent.
        for (which, side) in [
            (FlowBody::Request, "request"),
            (FlowBody::Response, "response"),
        ] {
            assert!(read_raw_body(&ctx.blobs(), &flow.id, which).unwrap().is_empty(), "{side}");
        }
        let read =
            |which: &str| rpc(&ctx, "get_flow_body", json!({ "flowId": flow.id, "which": which }));
        assert_eq!(
            read("request").await.unwrap()["data"],
            BASE64.encode(grpc_frame(0, &proto("Ada", None)))
        );
        assert_eq!(read("response").await.unwrap()["data"], BASE64.encode(&body));

        let failing = format!("http://{upstream}/pkg.Greeter/Missing");
        client
            .post(&failing)
            .header("content-type", "application/grpc-web+proto")
            .body(grpc_frame(0, &proto("Bo", None)))
            .send()
            .await
            .unwrap();
        let failed = wait_for(&ctx, &failing, |f| f.elapsed_ms.is_some()).await;
        assert_eq!(
            (failed.grpc_status, failed.grpc_message.as_deref()),
            (Some(12), Some("not here"))
        );
        let errors = rpc(&ctx, "list_flows", json!({ "status": "error" })).await.unwrap();
        let ids: Vec<_> =
            errors["flows"].as_array().unwrap().iter().map(|f| f["id"].clone()).collect();
        assert_eq!(ids, vec![json!(failed.id)], "a non-zero status is a failed call");

        // A gateway that answers with its own page: that body is stored as any other.
        let gateway = format!("http://{upstream}/pkg.Down/Call");
        client
            .post(&gateway)
            .header("content-type", "application/grpc-web+proto")
            .body(grpc_frame(0, &proto("Cy", None)))
            .send()
            .await
            .unwrap();
        let down = wait_for(&ctx, &gateway, |f| f.elapsed_ms.is_some()).await;
        assert_eq!(
            read_raw_body(&ctx.blobs(), &down.id, FlowBody::Response).unwrap(),
            b"upstream down"
        );
        let page = rpc(&ctx, "get_flow_body", json!({ "flowId": down.id, "which": "response" }))
            .await
            .unwrap();
        assert_eq!(page["data"], BASE64.encode("upstream down"));

        // A connection that gives out partway through a message: what came of it is kept.
        let cut_url = format!("http://{upstream}/pkg.Greeter/Cut");
        let sent = client
            .post(&cut_url)
            .header("content-type", "application/grpc-web+proto")
            .body(grpc_frame(0, &proto("Di", None)))
            .send()
            .await;
        if let Ok(resp) = sent {
            let _ = resp.bytes().await;
        }
        let cut = wait_for(&ctx, &cut_url, |f| f.elapsed_ms.is_some() || f.error.is_some()).await;
        let cut = wait_for(&ctx, &cut_url, |f| f.id == cut.id && f.message_count == 3).await;
        let listed = rpc(&ctx, "list_messages", json!({ "flowId": cut.id })).await.unwrap();
        let last = &listed["messages"][2];
        assert_eq!((last["truncated"].as_bool(), last["size"].as_i64()), (Some(true), Some(12)));
        let cut_body = rpc(&ctx, "get_flow_body", json!({ "flowId": cut.id, "which": "response" }))
            .await
            .unwrap();
        let mut cut_sent = grpc_frame(0, &proto("whole", None));
        cut_sent.extend(&grpc_frame(0, &proto("half of it", None))[..9]);
        assert_eq!(
            cut_body["data"],
            BASE64.encode(&cut_sent),
            "every byte that came, framed as it was"
        );
        assert_eq!(cut_body["truncated"], true);
        // The same bytes are what Save to File writes and what the HAR export carries.
        let saved_path = dir.path().join("cut.bin");
        let saved = rpc(
            &ctx,
            "save_flow_body",
            json!({ "flowId": cut.id, "which": "response", "path": saved_path }),
        )
        .await
        .unwrap();
        assert_eq!(saved["truncated"], true);
        assert_eq!(std::fs::read(&saved_path).unwrap(), cut_sent);
        let har_path = dir.path().join("cut.har");
        rpc(&ctx, "export_har", json!({ "ids": [cut.id], "path": har_path })).await.unwrap();
        let har: Value = serde_json::from_slice(&std::fs::read(&har_path).unwrap()).unwrap();
        let content = &har["log"]["entries"][0]["response"]["content"];
        assert_eq!(content["_truncated"], true);
        let text = content["text"].as_str().unwrap();
        let exported = match content["encoding"].as_str() {
            Some("base64") => BASE64.decode(text).unwrap(),
            _ => text.as_bytes().to_vec(),
        };
        assert_eq!(exported, cut_sent);

        // No schema, and reflection against the server fails: decoded by wire type alone.
        let decode = json!({ "flowId": flow.id, "seq": 1 });
        let schemaless = rpc(&ctx, "decode_grpc_message", decode.clone()).await.unwrap();
        assert_eq!(schemaless["messageType"], Value::Null);
        assert!(schemaless["note"].as_str().unwrap().contains("reflection failed"), "{schemaless}");
        let fields: Value = serde_json::from_str(schemaless["json"].as_str().unwrap()).unwrap();
        assert_eq!(fields[0]["string"], "Hello Ada");
        assert_eq!(fields[1], json!({ "field": 2, "wireType": "varint", "value": 3 }));

        // With the proto attached to the host, by name.
        let protos = tempfile::tempdir().unwrap();
        let added = rpc(
            &ctx,
            "add_grpc_schema",
            json!({ "hostPattern": "127.0.0.1", "protoPaths": [proto_file(protos.path())] }),
        )
        .await
        .unwrap();
        assert_eq!(added["services"], json!(["pkg.Greeter"]));
        assert_eq!(added["source"], "files");
        let decoded = rpc(&ctx, "decode_grpc_message", decode.clone()).await.unwrap();
        assert_eq!(decoded["messageType"], "pkg.HelloReply");
        let message: Value = serde_json::from_str(decoded["json"].as_str().unwrap()).unwrap();
        assert_eq!(message, json!({ "message": "Hello Ada", "count": 3 }));
        let request = json!({ "flowId": flow.id, "seq": 0 });
        let decoded = rpc(&ctx, "decode_grpc_message", request).await.unwrap();
        assert_eq!(decoded["messageType"], "pkg.HelloRequest");
        let trailers = json!({ "flowId": flow.id, "seq": 2 });
        assert!(
            rpc(&ctx, "decode_grpc_message", trailers).await.is_err(),
            "trailers are no message"
        );

        // The control API returns the same, and lists the messages.
        ctx.serve_control_api().unwrap();
        let info = ctx.control_info().unwrap();
        let api = reqwest::Client::new();
        let get = |path: String| {
            api.get(format!("{}{path}", info.base_url())).bearer_auth(&info.token).send()
        };
        let listed: Value = get(format!("/flows/{}/messages?after=0&limit=1", flow.id))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(
            (listed["total"].as_i64(), listed["messages"][0]["seq"].as_i64()),
            (Some(3), Some(1))
        );
        let detail: Value =
            get(format!("/flows/{}/messages/1", flow.id)).await.unwrap().json().await.unwrap();
        assert_eq!(detail["decoded"]["messageType"], "pkg.HelloReply");
        assert_eq!(detail["payload"]["encoding"], "utf8");
        let schemas: Value = get("/grpc-schemas".into()).await.unwrap().json().await.unwrap();
        assert_eq!(schemas.as_array().unwrap().len(), 1);

        let removed = rpc(&ctx, "remove_grpc_schema", json!({ "id": added["id"] })).await.unwrap();
        assert_eq!(removed, true);
        // Asked for schemaless, it is, with the schema there.
        let mut forced = decode.clone();
        forced["schemaless"] = json!(true);
        let without = rpc(&ctx, "decode_grpc_message", forced).await.unwrap();
        assert_eq!(without["messageType"], Value::Null);
        let response_body: Bytes =
            get(format!("/flows/{}/response-body", flow.id)).await.unwrap().bytes().await.unwrap();
        assert_eq!(response_body, body, "the control API reads it back the same");

        let after = rpc(&ctx, "decode_grpc_message", decode).await.unwrap();
        assert_eq!(after["messageType"], Value::Null);

        // Clearing removes the messages with their flows.
        rpc(&ctx, "clear_flows", json!({})).await.unwrap();
        assert!(rpc(&ctx, "list_messages", json!({ "flowId": flow.id })).await.is_err());
        // The rows go with the background delete the clear starts.
        let deadline = Instant::now() + Duration::from_secs(10);
        while ctx.db().with_conn(|c| yaak_proxy_lib::flows::clear_mark(c.conn().resolve())) > 0 {
            assert!(Instant::now() < deadline, "cleared flows were not deleted");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let left: i64 = ctx.db().with_conn(|c| {
            c.conn()
                .resolve()
                .query_row("SELECT COUNT(*) FROM flow_messages", [], |r| r.get(0))
                .unwrap()
        });
        assert_eq!(left, 0);
        ctx.stop_control_api();
    })
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn grpc_schemas_come_from_the_servers_reflection() {
    within(async {
        let protos = tempfile::tempdir().unwrap();
        let pool =
            yaak_grpc::fill_pool_from_files(&protoc(), &vec![proto_file(protos.path()).into()])
                .await
                .unwrap();
        let descriptors = pool.encode_to_vec();
        let reflection = tonic_reflection::server::Builder::configure()
            .register_encoded_file_descriptor_set(&descriptors)
            .build_v1()
            .unwrap();
        let upstream = spawn_upstream(Some(reflection_service(reflection))).await;

        let dir = tempfile::tempdir().unwrap();
        let (ctx, _event_rx) = start(dir.path());
        // Plain HTTP, so reflection is asked without TLS, as the call was made.
        let url = format!("http://{upstream}/pkg.Greeter/SayHello");
        client(&ctx)
            .post(&url)
            .header("content-type", "application/grpc-web+proto")
            .body(grpc_frame(0, &proto("Cy", None)))
            .send()
            .await
            .unwrap();
        let flow = wait_for(&ctx, &url, |f| f.elapsed_ms.is_some()).await;

        // Nothing attached: the server is asked once, and its answer kept for the host. Two
        // decodes at once both wait for that answer.
        let request = json!({ "flowId": flow.id, "seq": 1 });
        let (decoded, alongside) = tokio::join!(
            rpc(&ctx, "decode_grpc_message", request.clone()),
            rpc(&ctx, "decode_grpc_message", request)
        );
        let (decoded, alongside) = (decoded.unwrap(), alongside.unwrap());
        assert_eq!(decoded["messageType"], "pkg.HelloReply", "{decoded}");
        assert_eq!(alongside["messageType"], "pkg.HelloReply", "{alongside}");
        assert_eq!(decoded["schema"]["source"], "reflection");
        assert_eq!(decoded["schema"]["hostPattern"], format!("127.0.0.1:{}", upstream.port()));
        let schemas = rpc(&ctx, "list_grpc_schemas", json!({})).await.unwrap();
        assert_eq!(schemas.as_array().unwrap().len(), 1);

        // Asked again on demand, it replaces the host's earlier answer.
        let host = format!("http://127.0.0.1:{}", upstream.port());
        let again = rpc(&ctx, "reflect_grpc_host", json!({ "host": host })).await.unwrap();
        assert_eq!(again["services"], json!(["pkg.Greeter"]));
        let schemas = rpc(&ctx, "list_grpc_schemas", json!({})).await.unwrap();
        assert_eq!(schemas.as_array().unwrap().len(), 1);
    })
    .await
}
