use log::warn;
use prost_reflect::{DescriptorPool, FieldDescriptor, MessageDescriptor};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Default, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct JsonSchemaEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,

    // ref no need type
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    type_: Option<JsonType>,

    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    properties: Option<HashMap<String, JsonSchemaEntry>>,

    // enum's name
    // DynamicMessage will transform name to value
    #[serde(rename = "enum", skip_serializing_if = "Option::is_none")]
    enum_: Option<Vec<String>>,

    // Don't allow any other properties in the object
    #[serde(skip_serializing_if = "skip_serial_if_false")]
    additional_properties: bool,

    // Set all properties to required
    #[serde(skip_serializing_if = "Option::is_none")]
    required: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    items: Option<Box<JsonSchemaEntry>>,

    #[serde(skip_serializing_if = "Option::is_none", rename = "$defs")]
    defs: Option<HashMap<String, JsonSchemaEntry>>,

    #[serde(skip_serializing_if = "Option::is_none", rename = "$ref")]
    ref_: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    one_of: Option<Vec<JsonSchemaEntry>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pattern_properties: Option<HashMap<String, JsonSchemaEntry>>,
}

impl JsonSchemaEntry {
    pub fn object() -> Self {
        JsonSchemaEntry {
            type_: Some(JsonType::Object),
            properties: Some(HashMap::new()),
            ..Default::default()
        }
    }
    pub fn boolean() -> Self {
        JsonSchemaEntry {
            type_: Some(JsonType::Boolean),
            ..Default::default()
        }
    }
    pub fn number() -> Self {
        JsonSchemaEntry {
            type_: Some(JsonType::Number),
            ..Default::default()
        }
    }

    pub fn string() -> Self {
        JsonSchemaEntry {
            type_: Some(JsonType::String),
            ..Default::default()
        }
    }

    pub fn bytes_string() -> Self {
        JsonSchemaEntry {
            type_: Some(JsonType::String),
            ..Default::default()
        }
    }
    pub fn reference(ref_: String) -> Self {
        JsonSchemaEntry {
            ref_: Some(ref_),
            ..Default::default()
        }
    }
    pub fn array(item: JsonSchemaEntry) -> Self {
        JsonSchemaEntry {
            type_: Some(JsonType::Array),
            items: Some(Box::new(item)),
            ..Default::default()
        }
    }
    pub fn enums(enums: Vec<String>) -> Self {
        JsonSchemaEntry {
            enum_: Some(enums),
            ..Default::default()
        }
    }
    pub fn one_of(one_of: Vec<JsonSchemaEntry>) -> Self {
        JsonSchemaEntry {
            one_of: Some(one_of),
            ..Default::default()
        }
    }
    pub fn pattern_properties(pattern: String, property: JsonSchemaEntry) -> Self {
        let mut map = HashMap::new();
        map.insert(pattern, property);
        JsonSchemaEntry {
            pattern_properties: Some(map),
            ..Default::default()
        }
    }
    pub fn null() -> Self {
        JsonSchemaEntry {
            type_: Some(JsonType::Null),
            ..Default::default()
        }
    }
}

fn skip_serial_if_false(b: &bool) -> bool {
    !*b
}

fn field_to_type_or_ref(root_name: &str, field: FieldDescriptor) -> JsonSchemaEntry {
    match field.kind() {
        prost_reflect::Kind::Bool => JsonSchemaEntry::boolean(),
        prost_reflect::Kind::Double
        | prost_reflect::Kind::Float
        | prost_reflect::Kind::Int32
        | prost_reflect::Kind::Int64
        | prost_reflect::Kind::Uint32
        | prost_reflect::Kind::Uint64
        | prost_reflect::Kind::Sint32
        | prost_reflect::Kind::Sint64
        | prost_reflect::Kind::Fixed32
        | prost_reflect::Kind::Fixed64
        | prost_reflect::Kind::Sfixed32
        | prost_reflect::Kind::Sfixed64 => JsonSchemaEntry::number(),
        prost_reflect::Kind::String => JsonSchemaEntry::string(),
        prost_reflect::Kind::Bytes => JsonSchemaEntry::bytes_string(),
        prost_reflect::Kind::Enum(enums) => {
            let values = enums.values().map(|v| v.name().to_string()).collect::<Vec<_>>();
            JsonSchemaEntry::enums(values)
        }
        prost_reflect::Kind::Message(fm) => {
            if root_name == fm.full_name() {
                JsonSchemaEntry::reference("#".to_string())
            } else {
                JsonSchemaEntry::reference(format!("#/definitions/{}", fm.full_name()))
            }
        }
    }
}

fn is_message_field(field: &FieldDescriptor) -> Option<MessageDescriptor> {
    match field.kind() {
        prost_reflect::Kind::Message(m) => Some(m),
        _ => None,
    }
}

fn map_key_pattern(field: &FieldDescriptor) -> &'static str {
    match field.kind() {
        prost_reflect::Kind::Bool => "^(true|false)$",
        prost_reflect::Kind::Int32
        | prost_reflect::Kind::Int64
        | prost_reflect::Kind::Uint32
        | prost_reflect::Kind::Uint64
        | prost_reflect::Kind::Sint32
        | prost_reflect::Kind::Sint64
        | prost_reflect::Kind::Fixed32
        | prost_reflect::Kind::Fixed64
        | prost_reflect::Kind::Sfixed32
        | prost_reflect::Kind::Sfixed64 => "^[0-9]+$",
        prost_reflect::Kind::String => ".*",
        _ => {
            unreachable!("map key pattern for {:?}", field.kind());
        }
    }
}

enum JsonType {
    String,
    Number,
    Object,
    Array,
    Boolean,
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
            JsonType::_UNKNOWN => serializer.serialize_str("unknown"),
        }
    }
}

pub fn message_to_json_schema(_: &DescriptorPool, root_msg: MessageDescriptor) -> JsonSchemaEntry {
    JsonSchemaGenerator::generate_json_schema(root_msg)
}

struct JsonSchemaGenerator {
    msg_mapping: HashMap<String, JsonSchemaEntry>,
}

impl JsonSchemaGenerator {
    pub fn new() -> Self {
        JsonSchemaGenerator {
            msg_mapping: HashMap::new(),
        }
    }

    pub fn generate_json_schema(msg: MessageDescriptor) -> JsonSchemaEntry {
        let generator = JsonSchemaGenerator::new();
        generator.scan_root(msg)
    }

    fn add_message(&mut self, msg: &MessageDescriptor) {
        let name = msg.full_name().to_string();
        if self.msg_mapping.contains_key(&name) {
            return;
        }
        self.msg_mapping.insert(name.clone(), JsonSchemaEntry::object());
    }

    fn scan_root(mut self, root_msg: MessageDescriptor) -> JsonSchemaEntry {
        self.init_structure(root_msg.clone());
        self.fill_properties(root_msg.clone());

        let mut root = self.msg_mapping.remove(root_msg.full_name()).unwrap();

        if self.msg_mapping.len() > 0 {
            root.defs = Some(self.msg_mapping);
        }
        root
    }

    fn fill_properties(&mut self, root_msg: MessageDescriptor) {
        let root_name = root_msg.full_name().to_string();

        let mut visited = std::collections::HashSet::new();
        let mut msg_queue = std::collections::VecDeque::new();
        msg_queue.push_back(root_msg);

        while !msg_queue.is_empty() {
            let msg = msg_queue.pop_front().unwrap();
            let msg_name = msg.full_name();
            if visited.contains(msg_name) {
                continue;
            }

            visited.insert(msg_name.to_string());

            let entry = self.msg_mapping.get_mut(msg_name).unwrap();

            for field in msg.fields() {
                let field_name = field.name().to_string();

                if let Some(oneof) = field.containing_oneof() {
                    let mut candidates = oneof
                        .fields()
                        .map(|f| {
                            if let Some(fm) = is_message_field(&f) {
                                msg_queue.push_back(fm);
                            }
                            // fields of any type, except map fields and repeated fields
                            // so convert directly is ok
                            field_to_type_or_ref(&root_name, f)
                        })
                        .collect::<Vec<_>>();

                    match field.cardinality() {
                        prost_reflect::Cardinality::Optional => {
                            // proto3 optional field is implemented as oneof
                            candidates.push(JsonSchemaEntry::null());
                        }
                        card @ _ => {
                            warn!("oneof field {} is not optional, but {:?}", field_name, card);
                        }
                    }

                    entry
                        .properties
                        .as_mut()
                        .unwrap()
                        .insert(field.name().to_string(), JsonSchemaEntry::one_of(candidates));
                    continue;
                }

                let (field_type, nest_msg) = {
                    if let Some(fm) = is_message_field(&field) {
                        if field.is_list() {
                            // repeated message type
                            (
                                JsonSchemaEntry::array(field_to_type_or_ref(&root_name, field)),
                                Some(fm),
                            )
                        } else if field.is_map() {
                            let key_field = fm.get_field_by_name("key").unwrap();
                            let value_field = fm.get_field_by_name("value").unwrap();

                            let key_pattern = map_key_pattern(&key_field);
                            if let Some(fm) = is_message_field(&value_field) {
                                (
                                    JsonSchemaEntry::pattern_properties(
                                        key_pattern.to_string(),
                                        field_to_type_or_ref(&root_name, value_field),
                                    ),
                                    Some(fm),
                                )
                            } else {
                                (
                                    JsonSchemaEntry::pattern_properties(
                                        key_pattern.to_string(),
                                        field_to_type_or_ref(&root_name, value_field),
                                    ),
                                    None,
                                )
                            }
                        } else {
                            (field_to_type_or_ref(&root_name, field), Some(fm))
                        }
                    } else {
                        if field.is_list() {
                            // repeated scalar type
                            (JsonSchemaEntry::array(field_to_type_or_ref(&root_name, field)), None)
                        } else {
                            (field_to_type_or_ref(&root_name, field), None)
                        }
                    }
                };

                if let Some(fm) = nest_msg {
                    msg_queue.push_back(fm);
                }

                entry.properties.as_mut().unwrap().insert(field_name, field_type);
            }
        }
    }

    fn init_structure(&mut self, root_msg: MessageDescriptor) {
        let mut visited = std::collections::HashSet::new();
        let mut msg_queue = std::collections::VecDeque::new();
        msg_queue.push_back(root_msg.clone());

        // level traversal, to make sure all message type is defined before used
        while !msg_queue.is_empty() {
            let msg = msg_queue.pop_front().unwrap();
            let name = msg.full_name();
            if visited.contains(name) {
                continue;
            }
            visited.insert(name.to_string());
            self.add_message(&msg);

            for child in msg.child_messages() {
                if child.is_map_entry() {
                    //  for field with map<key, value> type, there will be a child message type *Entry generated
                    // just skip it
                    continue;
                }

                self.add_message(&child);
                msg_queue.push_back(child);
            }

            for field in msg.fields() {
                if let Some(oneof) = field.containing_oneof() {
                    for oneof_field in oneof.fields() {
                        if let Some(fm) = is_message_field(&oneof_field) {
                            self.add_message(&fm);
                            msg_queue.push_back(fm);
                        }
                    }
                    continue;
                }
                if field.is_map() {
                    // key is always scalar type, so no need to process
                    // value can be any type, so need to unpack value type
                    let map_field_msg = is_message_field(&field).unwrap();
                    let map_value_field = map_field_msg.get_field_by_name("value").unwrap();
                    if let Some(value_fm) = is_message_field(&map_value_field) {
                        self.add_message(&value_fm);
                        msg_queue.push_back(value_fm);
                    }
                    continue;
                }
                if let Some(fm) = is_message_field(&field) {
                    self.add_message(&fm);
                    msg_queue.push_back(fm);
                }
            }
        }
    }
}
