use prost_reflect::{DynamicMessage, MethodDescriptor, SerializeOptions};
use serde::{Deserialize, Serialize};
use serde_json::Deserializer;

mod codec;
mod json_schema;
pub mod manager;
mod proto;

pub use tonic::metadata::*;
pub use tonic::Code;

pub fn serialize_options() -> SerializeOptions {
    SerializeOptions::new().skip_default_fields(false)
}

#[derive(Serialize, Deserialize, Debug, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ServiceDefinition {
    pub name: String,
    pub methods: Vec<MethodDefinition>,
}

#[derive(Serialize, Deserialize, Debug, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MethodDefinition {
    pub name: String,
    pub schema: String,
    pub client_streaming: bool,
    pub server_streaming: bool,
}

static SERIALIZE_OPTIONS: &'static SerializeOptions = &SerializeOptions::new()
    .skip_default_fields(false)
    .stringify_64_bit_integers(false);

pub fn serialize_message(msg: &DynamicMessage) -> Result<String, String> {
    let mut buf = Vec::new();
    let mut se = serde_json::Serializer::pretty(&mut buf);
    msg.serialize_with_options(&mut se, SERIALIZE_OPTIONS)
        .map_err(|e| e.to_string())?;
    let s = String::from_utf8(buf).expect("serde_json to emit valid utf8");
    Ok(s)
}

pub fn deserialize_message(msg: &str, method: MethodDescriptor) -> Result<DynamicMessage, String> {
    let mut deserializer = Deserializer::from_str(&msg);
    let req_message = DynamicMessage::deserialize(method.input(), &mut deserializer)
        .map_err(|e| e.to_string())?;
    deserializer.end().map_err(|e| e.to_string())?;
    Ok(req_message)
}
