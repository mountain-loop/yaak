use prost_reflect::{DescriptorPool, MessageDescriptor};
use prost_types::field_descriptor_proto;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct JsonSchemaEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,

    #[serde(rename = "type")]
    type_: JsonType,

    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    properties: Option<HashMap<String, JsonSchemaEntry>>,

    #[serde(rename = "enum", skip_serializing_if = "Option::is_none")]
    enum_: Option<Vec<String>>,

    /// Don't allow any other properties in the object
    additional_properties: bool,

    /// Set all properties to required
    #[serde(skip_serializing_if = "Option::is_none")]
    required: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    items: Option<Box<JsonSchemaEntry>>,
}

enum JsonType {
    String,
    Number,
    Object,
    Array,
    Boolean,
    Null,
    _UNKNOWN,
}

impl Default for JsonType {
    fn default() -> Self {
        JsonType::_UNKNOWN
    }
}

impl serde::Serialize for JsonType {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            JsonType::String => serializer.serialize_str("string"),
            JsonType::Number => serializer.serialize_str("number"),
            JsonType::Object => serializer.serialize_str("object"),
            JsonType::Array => serializer.serialize_str("array"),
            JsonType::Boolean => serializer.serialize_str("boolean"),
            JsonType::Null => serializer.serialize_str("null"),
            JsonType::_UNKNOWN => serializer.serialize_str("unknown"),
        }
    }
}

impl<'de> serde::Deserialize<'de> for JsonType {
    fn deserialize<D>(deserializer: D) -> Result<JsonType, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        match s.as_str() {
            "string" => Ok(JsonType::String),
            "number" => Ok(JsonType::Number),
            "object" => Ok(JsonType::Object),
            "array" => Ok(JsonType::Array),
            "boolean" => Ok(JsonType::Boolean),
            "null" => Ok(JsonType::Null),
            _ => Ok(JsonType::_UNKNOWN),
        }
    }
}

pub fn message_to_json_schema(
    pool: &DescriptorPool,
    message: MessageDescriptor,
) -> JsonSchemaEntry {
    let mut schema = JsonSchemaEntry {
        title: Some(message.name().to_string()),
        type_: JsonType::Object, // Messages are objects
        ..Default::default()
    };

    let mut properties = HashMap::new();
    message.fields().for_each(|f| match f.kind() {
        prost_reflect::Kind::Message(m) => {
            properties.insert(f.name().to_string(), message_to_json_schema(pool, m));
        }
        prost_reflect::Kind::Enum(e) => {
            properties.insert(
                f.name().to_string(),
                JsonSchemaEntry {
                    type_: map_proto_type_to_json_type(f.field_descriptor_proto().r#type()),
                    enum_: Some(e.values().map(|v| v.name().to_string()).collect::<Vec<_>>()),
                    ..Default::default()
                },
            );
        }
        _ => {
            // TODO: Handle repeated label
            match f.field_descriptor_proto().label() {
                field_descriptor_proto::Label::Repeated => {
                    // TODO: Handle more complex repeated types. This just handles primitives for now
                    properties.insert(
                        f.name().to_string(),
                        JsonSchemaEntry {
                            type_: JsonType::Array,
                            items: Some(Box::new(JsonSchemaEntry {
                                type_: map_proto_type_to_json_type(
                                    f.field_descriptor_proto().r#type(),
                                ),
                                ..Default::default()
                            })),
                            ..Default::default()
                        },
                    );
                }
                _ => {
                    // Regular JSON field
                    properties.insert(
                        f.name().to_string(),
                        JsonSchemaEntry {
                            type_: map_proto_type_to_json_type(f.field_descriptor_proto().r#type()),
                            ..Default::default()
                        },
                    );
                }
            };
        }
    });

    schema.properties = Some(properties);

    // All proto 3 fields are optional, so maybe we could
    // make this a setting?
    // schema.required = Some(
    //     message
    //         .fields()
    //         .map(|f| f.name().to_string())
    //         .collect::<Vec<_>>(),
    // );

    schema
}

fn map_proto_type_to_json_type(proto_type: field_descriptor_proto::Type) -> JsonType {
    match proto_type {
        field_descriptor_proto::Type::Double => JsonType::Number,
        field_descriptor_proto::Type::Float => JsonType::Number,
        field_descriptor_proto::Type::Int64 => JsonType::Number,
        field_descriptor_proto::Type::Uint64 => JsonType::Number,
        field_descriptor_proto::Type::Int32 => JsonType::Number,
        field_descriptor_proto::Type::Fixed64 => JsonType::Number,
        field_descriptor_proto::Type::Fixed32 => JsonType::Number,
        field_descriptor_proto::Type::Bool => JsonType::Boolean,
        field_descriptor_proto::Type::String => JsonType::String,
        field_descriptor_proto::Type::Group => JsonType::_UNKNOWN,
        field_descriptor_proto::Type::Message => JsonType::Object,
        field_descriptor_proto::Type::Bytes => JsonType::String,
        field_descriptor_proto::Type::Uint32 => JsonType::Number,
        field_descriptor_proto::Type::Enum => JsonType::String,
        field_descriptor_proto::Type::Sfixed32 => JsonType::Number,
        field_descriptor_proto::Type::Sfixed64 => JsonType::Number,
        field_descriptor_proto::Type::Sint32 => JsonType::Number,
        field_descriptor_proto::Type::Sint64 => JsonType::Number,
    }
}
