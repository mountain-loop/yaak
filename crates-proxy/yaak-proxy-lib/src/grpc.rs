//! Decoding captured gRPC messages. A message decodes to JSON with the schema of its call's
//! service, found first in the protos attached to a host pattern, then in the server's own
//! reflection, asked once per host. Without one it decodes schemaless: field numbers, wire
//! types and values, with nested messages guessed.

use crate::db::ProxyQueryManager;
use crate::messages::{self, FlowMessage, MessageDirection, MessageKind};
use crate::models::Flow;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use chrono::NaiveDateTime;
use rusqlite::{Row, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use ts_rs::TS;
use yaak_database::generate_prefixed_id;
use yaak_grpc::GrpcConfig;
use yaak_grpc::prost_reflect::{DescriptorPool, DynamicMessage, MessageDescriptor};
use yaak_models::blob_manager::BlobManager;

/// Where a schema's descriptors came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_models.ts")]
pub enum GrpcSchemaSource {
    /// `.proto` files the user attached to a host pattern.
    Files,
    /// The server's reflection service.
    Reflection,
}

/// Descriptors for decoding the gRPC calls to hosts that match `hostPattern`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct GrpcSchema {
    pub id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    /// A host (`api.example.com`), a host and port (`localhost:50051`), any subdomain of one
    /// (`*.example.com`), or every host (`*`).
    pub host_pattern: String,
    pub source: GrpcSchemaSource,
    /// The `.proto` files and include directories compiled, for a `files` schema.
    pub proto_paths: Vec<String>,
    /// The services the descriptors define, by full name.
    pub services: Vec<String>,
}

/// A captured gRPC message as JSON.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct DecodedGrpcMessage {
    /// Pretty JSON: the message's fields by name with a schema; without one, an array of its
    /// fields as `{ field, wireType, value }`, a length-delimited one with its guesses (`string`,
    /// `message`, `bytes` in base64).
    pub json: String,
    /// The message type decoded with: `package.HelloReply`. None when schemaless.
    pub message_type: Option<String>,
    /// The schema decoded with. None when schemaless.
    pub schema: Option<GrpcSchema>,
    /// Why it decoded schemaless, or what to know about the decode.
    pub note: Option<String>,
}

/// What a host's reflection answered, once it has; decodes that need it while it is being asked
/// wait for the same answer.
type Lookup = Arc<tokio::sync::OnceCell<Result<GrpcSchema, String>>>;

/// The decoded descriptor pools, by schema id, and the hosts reflection was asked of.
#[derive(Clone, Default)]
pub struct GrpcState {
    protoc: Arc<Mutex<Option<GrpcConfig>>>,
    pools: Arc<Mutex<HashMap<String, DescriptorPool>>>,
    /// By `host:port`.
    lookups: Arc<Mutex<HashMap<String, Lookup>>>,
}

impl GrpcState {
    pub fn set_protoc(&self, config: GrpcConfig) {
        if let Ok(mut protoc) = self.protoc.lock() {
            *protoc = Some(config);
        }
    }

    /// The protoc set with [`Self::set_protoc`], or else one on `PATH`, with the `include`
    /// directory installed beside it.
    fn protoc(&self) -> Result<GrpcConfig, String> {
        if let Some(config) = self.protoc.lock().ok().and_then(|p| p.clone()) {
            return Ok(config);
        }
        protoc_on_path(std::env::var_os("PATH"))
    }
}

/// What to do when there is no protoc to compile attached `.proto` files with.
pub const NO_PROTOC: &str = "Yaak Proxy has no protoc to compile .proto files with. A packaged \
    Yaak Proxy includes one; otherwise install protoc (on macOS, `brew install protobuf`) so it \
    is on PATH, or let the server's reflection supply the schema.";

/// A `protoc` in one of the directories of `path`, a `PATH` value, with the `include` directory
/// installed beside it.
fn protoc_on_path(path: Option<std::ffi::OsString>) -> Result<GrpcConfig, String> {
    let name = if cfg!(windows) { "protoc.exe" } else { "protoc" };
    let bin = path
        .iter()
        .flat_map(std::env::split_paths)
        .map(|dir| dir.join(name))
        .find(|p| p.is_file())
        .ok_or(NO_PROTOC)?;
    let include = bin.parent().and_then(|d| d.parent()).map(|d| d.join("include"));
    Ok(GrpcConfig { protoc_include_dir: include.unwrap_or_default(), protoc_bin_path: bin })
}

const COLUMNS: &str = "id, created_at, updated_at, host_pattern, source, proto_paths, services";

fn schema_from_row(r: &Row) -> rusqlite::Result<GrpcSchema> {
    let source: String = r.get("source")?;
    let proto_paths: String = r.get("proto_paths")?;
    let services: String = r.get("services")?;
    Ok(GrpcSchema {
        id: r.get("id")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        host_pattern: r.get("host_pattern")?,
        source: if source == "reflection" {
            GrpcSchemaSource::Reflection
        } else {
            GrpcSchemaSource::Files
        },
        proto_paths: serde_json::from_str(&proto_paths).unwrap_or_default(),
        services: serde_json::from_str(&services).unwrap_or_default(),
    })
}

pub fn list(db: &ProxyQueryManager) -> Result<Vec<GrpcSchema>, String> {
    db.with_conn(|c| {
        let conn = c.conn().resolve();
        let mut stmt = conn
            .prepare(&format!("SELECT {COLUMNS} FROM grpc_schemas ORDER BY created_at, id"))
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], schema_from_row).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

fn get(db: &ProxyQueryManager, id: &str) -> Result<GrpcSchema, String> {
    db.with_conn(|c| {
        c.conn()
            .resolve()
            .query_row(
                &format!("SELECT {COLUMNS} FROM grpc_schemas WHERE id = ?1"),
                [id],
                schema_from_row,
            )
            .map_err(|_| format!("No gRPC schema {id}"))
    })
}

fn insert(
    db: &ProxyQueryManager,
    host_pattern: &str,
    source: GrpcSchemaSource,
    proto_paths: &[String],
    pool: &DescriptorPool,
) -> Result<GrpcSchema, String> {
    let id = generate_prefixed_id("gs");
    let services: Vec<String> = pool.services().map(|s| s.full_name().to_string()).collect();
    let source_name = match source {
        GrpcSchemaSource::Files => "files",
        GrpcSchemaSource::Reflection => "reflection",
    };
    db.with_tx(|c| {
        let conn = c.conn().resolve();
        // A host's reflection is kept once, the latest.
        if source == GrpcSchemaSource::Reflection {
            conn.execute(
                "DELETE FROM grpc_schemas WHERE source = 'reflection' AND host_pattern = ?1",
                [host_pattern],
            )?;
        }
        conn.execute(
            "INSERT INTO grpc_schemas (id, host_pattern, source, proto_paths, services, descriptor) \
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                host_pattern,
                source_name,
                serde_json::to_string(proto_paths).unwrap_or_default(),
                serde_json::to_string(&services).unwrap_or_default(),
                pool.encode_to_vec(),
            ],
        )?;
        Ok::<_, yaak_database::Error>(())
    })
    .map_err(|e| format!("Failed to save the gRPC schema: {e}"))?;
    get(db, &id)
}

/// Compiles `proto_paths` (files, and directories to import from) and attaches them to
/// `host_pattern`.
pub async fn add(
    db: &ProxyQueryManager,
    state: &GrpcState,
    host_pattern: &str,
    proto_paths: &[String],
) -> Result<GrpcSchema, String> {
    let host_pattern = host_pattern.trim().to_ascii_lowercase();
    if host_pattern.is_empty() {
        return Err("A host pattern is required".into());
    }
    if proto_paths.is_empty() {
        return Err("At least one .proto file is required".into());
    }
    let paths: Vec<PathBuf> = proto_paths.iter().map(PathBuf::from).collect();
    if let Some(missing) = paths.iter().find(|p| !p.exists()) {
        return Err(format!("{} does not exist", missing.display()));
    }
    let config = state.protoc()?;
    let pool = yaak_grpc::fill_pool_from_files(&config, &paths)
        .await
        .map_err(|e| format!("Failed to compile the protos: {e}"))?;
    insert(db, &host_pattern, GrpcSchemaSource::Files, proto_paths, &pool)
}

pub fn remove(db: &ProxyQueryManager, state: &GrpcState, id: &str) -> Result<bool, String> {
    let removed = db
        .with_tx(|c| {
            let removed =
                c.conn().resolve().execute("DELETE FROM grpc_schemas WHERE id = ?1", [id])?;
            Ok::<_, yaak_database::Error>(removed)
        })
        .map_err(|e| e.to_string())?;
    if let Ok(mut pools) = state.pools.lock() {
        pools.remove(id);
    }
    Ok(removed > 0)
}

/// How long a server has to answer reflection, all of it.
const REFLECTION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// A host to ask for reflection, as given to `reflect_grpc_host`: `host`, `host:port`, or
/// either after `http://` or `https://`. Returns `host:port` and whether to ask without TLS;
/// without a scheme, over TLS on 443.
pub fn reflection_host(host: &str) -> (String, bool) {
    let host = host.trim().trim_end_matches('/').to_ascii_lowercase();
    let (host, plaintext) = match host.strip_prefix("http://") {
        Some(rest) => (rest.to_string(), true),
        None => (host.strip_prefix("https://").unwrap_or(&host).to_string(), false),
    };
    let has_port = host.rsplit_once(':').is_some_and(|(_, port)| port.parse::<u16>().is_ok());
    if has_port {
        return (host, plaintext);
    }
    (format!("{host}:{}", if plaintext { 80 } else { 443 }), plaintext)
}

/// Asks the server at `authority` (`host:port`) for its services by reflection, without TLS
/// when `plaintext`, and keeps them as the host's schema, also for decodes to come. Fails when
/// it offers none.
pub async fn reflect(
    db: &ProxyQueryManager,
    state: &GrpcState,
    authority: &str,
    plaintext: bool,
) -> Result<GrpcSchema, String> {
    let authority = authority.trim().to_ascii_lowercase();
    let reflected = reflect_uncached(db, &authority, plaintext).await;
    if let Ok(mut lookups) = state.lookups.lock() {
        let answered = tokio::sync::OnceCell::new_with(Some(reflected.clone()));
        lookups.insert(authority, Arc::new(answered));
    }
    reflected
}

async fn reflect_uncached(
    db: &ProxyQueryManager,
    authority: &str,
    plaintext: bool,
) -> Result<GrpcSchema, String> {
    let scheme = if plaintext { "http" } else { "https" };
    let uri: hyper::Uri = format!("{scheme}://{authority}")
        .parse()
        .map_err(|e| format!("Invalid host {authority}: {e}"))?;
    // Reflection's client panics on an answer it does not expect; that ends this task alone.
    // Timed out inside the task, so a server that stalls leaves nothing running.
    let timeout_error = format!("{authority} did not answer reflection in time");
    let reflected = tokio::spawn(async move {
        let metadata = Default::default();
        let reflecting =
            yaak_grpc::fill_pool_from_reflection(&uri, &metadata, true, None, 64 << 20);
        match tokio::time::timeout(REFLECTION_TIMEOUT, reflecting).await {
            Ok(reflected) => reflected.map_err(|e| e.to_string()),
            Err(_) => Err(timeout_error),
        }
    })
    .await
    .map_err(|_| format!("{authority} answered reflection with something unexpected"))??;
    if reflected.services().next().is_none() {
        return Err(format!("{authority} offers no services by reflection"));
    }
    insert(db, authority, GrpcSchemaSource::Reflection, &[], &reflected)
}

/// Whether `pattern` covers `host` (lowercase, no port) at `authority` (`host:port`).
fn matches(pattern: &str, host: &str, authority: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    let target = if pattern.contains(':') { authority } else { host };
    match pattern.strip_prefix("*.") {
        Some(domain) => target.strip_suffix(domain).is_some_and(|rest| rest.ends_with('.')),
        None => pattern == target,
    }
}

impl GrpcState {
    fn pool(&self, db: &ProxyQueryManager, id: &str) -> Result<DescriptorPool, String> {
        if let Some(pool) = self.pools.lock().ok().and_then(|p| p.get(id).cloned()) {
            return Ok(pool);
        }
        let bytes: Vec<u8> = db.with_conn(|c| {
            c.conn()
                .resolve()
                .query_row("SELECT descriptor FROM grpc_schemas WHERE id = ?1", [id], |r| r.get(0))
                .map_err(|e| e.to_string())
        })?;
        let pool = DescriptorPool::decode(bytes.as_slice()).map_err(|e| e.to_string())?;
        if let Ok(mut pools) = self.pools.lock() {
            pools.insert(id.to_string(), pool.clone());
        }
        Ok(pool)
    }
}

/// The schema that defines `service` for the host at `authority`: attached protos first, the
/// most specific pattern first, then the host's reflection, asked of the server once, without
/// TLS when `plaintext`, as the call was made.
async fn find_schema(
    db: &ProxyQueryManager,
    state: &GrpcState,
    authority: &str,
    plaintext: bool,
    service: &str,
) -> Result<(Option<(GrpcSchema, DescriptorPool)>, Option<String>), String> {
    let host = authority.rsplit_once(':').map_or(authority, |(h, _)| h);
    let mut schemas: Vec<GrpcSchema> =
        list(db)?.into_iter().filter(|s| matches(&s.host_pattern, host, authority)).collect();
    // Files before reflection; then exact before wildcards, the narrower first.
    schemas.sort_by_key(|s| {
        let wildcard = s.host_pattern.starts_with('*');
        (
            s.source == GrpcSchemaSource::Reflection,
            wildcard,
            std::cmp::Reverse(s.host_pattern.len()),
        )
    });
    for schema in &schemas {
        let pool = state.pool(db, &schema.id)?;
        if pool.get_service_by_name(service).is_some() {
            return Ok((Some((schema.clone(), pool)), None));
        }
    }
    if schemas.iter().any(|s| s.source == GrpcSchemaSource::Reflection) {
        return Ok((None, Some(format!("No schema for {service} on {authority}"))));
    }
    // Asked once: decodes that come while it is being asked wait for the same answer.
    let Some(lookup) =
        state.lookups.lock().ok().map(|mut l| l.entry(authority.into()).or_default().clone())
    else {
        return Ok((None, Some(format!("No schema for {service} on {authority}"))));
    };
    let answer = lookup.get_or_init(|| reflect_uncached(db, authority, plaintext)).await.clone();
    match answer {
        // Unless it was removed since.
        Ok(schema) => match state.pool(db, &schema.id) {
            Ok(pool) if pool.get_service_by_name(service).is_some() => {
                Ok((Some((schema, pool)), None))
            }
            Ok(_) => {
                Ok((None, Some(format!("{authority}'s reflection does not include {service}"))))
            }
            Err(_) => Ok((None, Some(format!("No schema for {service} on {authority}")))),
        },
        Err(e) => Ok((None, Some(format!("No schema for {service}; reflection failed: {e}")))),
    }
}

/// Decodes a captured gRPC message.
pub async fn decode(
    db: &ProxyQueryManager,
    blobs: &BlobManager,
    state: &GrpcState,
    flow: &Flow,
    seq: i64,
) -> Result<DecodedGrpcMessage, String> {
    let message = messages::get(db, &flow.id, seq)?;
    if message.kind != MessageKind::GrpcMessage {
        return Err(format!("Message {seq} is not a gRPC message"));
    }
    let payload = messages::payload(db, blobs, &message)?;
    if message.compressed && message.error.is_some() {
        return Err(message.error.unwrap_or_default());
    }
    let (Some(service), Some(method)) = (&flow.grpc_service, &flow.grpc_method) else {
        return Ok(schemaless(&payload, &message, Some("The call's path names no service".into())));
    };
    let url = url::Url::parse(&flow.url).map_err(|e| e.to_string())?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let authority = format!("{host}:{}", url.port_or_known_default().unwrap_or(443));
    let plaintext = url.scheme() == "http";
    let (found, note) = find_schema(db, state, &authority, plaintext, service).await?;
    let Some((schema, pool)) = found else {
        return Ok(schemaless(&payload, &message, note));
    };
    let Some(descriptor) = pool
        .get_service_by_name(service)
        .and_then(|s| s.methods().find(|m| m.name() == method))
        .map(|m| match message.direction {
            MessageDirection::Client => m.input(),
            MessageDirection::Server => m.output(),
        })
    else {
        let note = format!("{} has no method {method}", service);
        return Ok(schemaless(&payload, &message, Some(note)));
    };
    decode_with(&payload, &message, descriptor, schema)
}

fn decode_with(
    payload: &[u8],
    message: &FlowMessage,
    descriptor: MessageDescriptor,
    schema: GrpcSchema,
) -> Result<DecodedGrpcMessage, String> {
    let message_type = descriptor.full_name().to_string();
    match DynamicMessage::decode(descriptor, payload) {
        Ok(decoded) => Ok(DecodedGrpcMessage {
            json: yaak_grpc::message_to_json(&decoded)?,
            message_type: Some(message_type),
            schema: Some(schema),
            note: message.truncated.then(|| "The message is cut at the capture limit".into()),
        }),
        Err(e) => {
            Ok(schemaless(payload, message, Some(format!("Did not decode as {message_type}: {e}"))))
        }
    }
}

fn schemaless(payload: &[u8], message: &FlowMessage, reason: Option<String>) -> DecodedGrpcMessage {
    let mut notes: Vec<String> = reason.into_iter().collect();
    notes.push("Decoded without a schema: field names and types are guesses".into());
    if message.truncated {
        notes.push("The message is cut at the capture limit".into());
    }
    let fields = decode_fields(payload, 0).unwrap_or_else(|| {
        notes.push("Not a valid protobuf message: shown as bytes".into());
        vec![json!({ "bytes": BASE64.encode(payload) })]
    });
    DecodedGrpcMessage {
        json: serde_json::to_string_pretty(&fields).unwrap_or_default(),
        message_type: None,
        schema: None,
        note: Some(notes.join(". ")),
    }
}

const MAX_DEPTH: usize = 16;

/// A message's fields from the protobuf wire format, None when the bytes are not one.
pub fn decode_fields(mut bytes: &[u8], depth: usize) -> Option<Vec<Value>> {
    let mut fields = Vec::new();
    while !bytes.is_empty() {
        let key = read_varint(&mut bytes)?;
        let field = key >> 3;
        if field == 0 || field > 536_870_911 {
            return None;
        }
        let value = match key & 7 {
            0 => {
                let v = read_varint(&mut bytes)?;
                json!({ "field": field, "wireType": "varint", "value": number(v) })
            }
            1 => {
                let raw: [u8; 8] = bytes.get(..8)?.try_into().ok()?;
                bytes = &bytes[8..];
                let v = u64::from_le_bytes(raw);
                json!({ "field": field, "wireType": "fixed64", "value": number(v), "double": f64::from_le_bytes(raw) })
            }
            2 => {
                let len = usize::try_from(read_varint(&mut bytes)?).ok()?;
                let data = bytes.get(..len)?;
                bytes = &bytes[len..];
                let mut value = json!({ "field": field, "wireType": "len" });
                let text = std::str::from_utf8(data)
                    .ok()
                    .filter(|s| s.chars().all(|c| !c.is_control() || c.is_whitespace()));
                if let Some(text) = text {
                    value["string"] = json!(text);
                }
                if depth < MAX_DEPTH
                    && !data.is_empty()
                    && let Some(nested) = decode_fields(data, depth + 1)
                {
                    value["message"] = json!(nested);
                }
                if text.is_none() {
                    value["bytes"] = json!(BASE64.encode(data));
                }
                value
            }
            5 => {
                let raw: [u8; 4] = bytes.get(..4)?.try_into().ok()?;
                bytes = &bytes[4..];
                let v = u32::from_le_bytes(raw);
                json!({ "field": field, "wireType": "fixed32", "value": v, "float": f32::from_le_bytes(raw) })
            }
            // Groups are long deprecated; 6 and 7 are no wire type.
            _ => return None,
        };
        fields.push(value);
    }
    Some(fields)
}

/// A u64 as a JSON number when JavaScript can hold it exactly, else as a string.
fn number(v: u64) -> Value {
    if v <= (1 << 53) { json!(v) } else { json!(v.to_string()) }
}

fn read_varint(bytes: &mut &[u8]) -> Option<u64> {
    let mut value = 0u64;
    for i in 0..10 {
        let byte = *bytes.get(i)?;
        value |= u64::from(byte & 0x7f) << (7 * i);
        if byte & 0x80 == 0 {
            *bytes = &bytes[i + 1..];
            return Some(value);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn without_protoc_the_error_says_what_to_install() {
        let empty = tempfile::tempdir().unwrap();
        let err = protoc_on_path(Some(empty.path().as_os_str().to_owned())).err().unwrap();
        assert_eq!(err, NO_PROTOC);
        assert!(err.contains("brew install protobuf"), "{err}");
        assert!(protoc_on_path(None).is_err());
    }

    #[test]
    fn reflection_hosts() {
        assert_eq!(reflection_host("api.example.com"), ("api.example.com:443".into(), false));
        assert_eq!(reflection_host("localhost:50051"), ("localhost:50051".into(), false));
        assert_eq!(reflection_host("http://localhost:50051"), ("localhost:50051".into(), true));
        assert_eq!(reflection_host("http://Example.com/"), ("example.com:80".into(), true));
        assert_eq!(reflection_host("https://example.com"), ("example.com:443".into(), false));
    }

    #[test]
    fn host_patterns() {
        assert!(matches("api.example.com", "api.example.com", "api.example.com:443"));
        assert!(!matches("api.example.com", "www.example.com", "www.example.com:443"));
        assert!(matches("*.example.com", "a.b.example.com", "a.b.example.com:443"));
        assert!(!matches("*.example.com", "example.com", "example.com:443"));
        assert!(!matches("*.example.com", "badexample.com", "badexample.com:443"));
        assert!(matches("localhost:50051", "localhost", "localhost:50051"));
        assert!(!matches("localhost:50051", "localhost", "localhost:50052"));
        assert!(matches("*", "anything", "anything:1"));
    }

    #[test]
    fn decodes_the_wire_format_without_a_schema() {
        // field 1: varint 150; field 2: "hi"; field 3: nested { field 1: 1 }
        let bytes = [
            0x08, 0x96, 0x01, 0x12, 0x02, b'h', b'i', 0x1a, 0x02, 0x08, 0x01,
        ];
        let fields = decode_fields(&bytes, 0).unwrap();
        assert_eq!(fields[0], json!({ "field": 1, "wireType": "varint", "value": 150 }));
        assert_eq!(fields[1]["string"], "hi");
        assert_eq!(fields[2]["message"][0]["value"], 1);
        assert!(decode_fields(&[0x08], 0).is_none(), "a varint cut short");
    }
}
