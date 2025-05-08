use prost_reflect::{DescriptorPool, FieldDescriptor, MessageDescriptor};
use std::collections::{HashMap, HashSet, VecDeque};

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

    pub fn scan_root(mut self, root_msg: MessageDescriptor) -> JsonSchemaEntry {
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

        let mut visited = HashSet::new();
        let mut msg_queue = VecDeque::new();
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

                if matches!(field.cardinality(), prost_reflect::Cardinality::Required) {
                    entry.add_required(field_name.clone());
                }

                if let Some(oneof) = field.containing_oneof() {
                    for oneof_field in oneof.fields() {
                        if let Some(fm) = is_message_field(&oneof_field) {
                            msg_queue.push_back(fm);
                        }
                        entry.add_property(
                            oneof_field.name().to_string(),
                            field_to_type_or_ref(&root_name, oneof_field),
                        );
                    }
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
                            let value_field = fm.get_field_by_name("value").unwrap();

                            if let Some(fm) = is_message_field(&value_field) {
                                (
                                    JsonSchemaEntry::map(field_to_type_or_ref(
                                        &root_name,
                                        value_field,
                                    )),
                                    Some(fm),
                                )
                            } else {
                                (
                                    JsonSchemaEntry::map(field_to_type_or_ref(
                                        &root_name,
                                        value_field,
                                    )),
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

                entry.add_property(field_name, field_type);
            }
        }
    }

    fn init_structure(&mut self, root_msg: MessageDescriptor) {
        let mut visited = HashSet::new();
        let mut msg_queue = VecDeque::new();
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

fn field_to_type_or_ref(root_name: &str, field: FieldDescriptor) -> JsonSchemaEntry {
    match field.kind() {
        prost_reflect::Kind::Bool => JsonSchemaEntry::boolean(),
        prost_reflect::Kind::Double => JsonSchemaEntry::number("double"),
        prost_reflect::Kind::Float => JsonSchemaEntry::number("float"),
        prost_reflect::Kind::Int32 => JsonSchemaEntry::number("int32"),
        prost_reflect::Kind::Int64 => JsonSchemaEntry::string_with_format("int64"),
        prost_reflect::Kind::Uint32 => JsonSchemaEntry::number("int64"),
        prost_reflect::Kind::Uint64 => JsonSchemaEntry::string_with_format("uint64"),
        prost_reflect::Kind::Sint32 => JsonSchemaEntry::number("sint32"),
        prost_reflect::Kind::Sint64 => JsonSchemaEntry::string_with_format("sint64"),
        prost_reflect::Kind::Fixed32 => JsonSchemaEntry::number("int64"),
        prost_reflect::Kind::Fixed64 => JsonSchemaEntry::string_with_format("fixed64"),
        prost_reflect::Kind::Sfixed32 => JsonSchemaEntry::number("sfixed32"),
        prost_reflect::Kind::Sfixed64 => JsonSchemaEntry::string_with_format("sfixed64"),
        prost_reflect::Kind::String => JsonSchemaEntry::string(),
        prost_reflect::Kind::Bytes => JsonSchemaEntry::string_with_format("byte"),
        prost_reflect::Kind::Enum(enums) => {
            let values = enums.values().map(|v| v.name().to_string()).collect::<Vec<_>>();
            JsonSchemaEntry::enums(values)
        }
        prost_reflect::Kind::Message(fm) => {
            let field_type_full_name = fm.full_name();
            match field_type_full_name {
                // [Protocol Buffers Well-Known Types]: https://protobuf.dev/reference/protobuf/google.protobuf/
                "google.protobuf.FieldMask" => JsonSchemaEntry::string(),
                "google.protobuf.Timestamp" => JsonSchemaEntry::string_with_format("date-time"),
                "google.protobuf.Duration" => JsonSchemaEntry::string(),
                "google.protobuf.StringValue" => JsonSchemaEntry::string(),
                "google.protobuf.BytesValue" => JsonSchemaEntry::string_with_format("byte"),
                "google.protobuf.Int32Value" => JsonSchemaEntry::number("int32"),
                "google.protobuf.UInt32Value" => JsonSchemaEntry::string_with_format("int64"),
                "google.protobuf.Int64Value" => JsonSchemaEntry::string_with_format("int64"),
                "google.protobuf.UInt64Value" => JsonSchemaEntry::string_with_format("uint64"),
                "google.protobuf.FloatValue" => JsonSchemaEntry::number("float"),
                "google.protobuf.DoubleValue" => JsonSchemaEntry::number("double"),
                "google.protobuf.BoolValue" => JsonSchemaEntry::boolean(),
                "google.protobuf.Empty" => JsonSchemaEntry::default(),
                "google.protobuf.Struct" => JsonSchemaEntry::object(),
                "google.protobuf.ListValue" => JsonSchemaEntry::array(JsonSchemaEntry::default()),
                "google.protobuf.NullValue" => JsonSchemaEntry::null(),
                name @ _ if name == root_name => JsonSchemaEntry::root_reference(),
                _ => JsonSchemaEntry::reference(fm.full_name()),
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

#[derive(Default, serde::Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct JsonSchemaEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,

    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    type_: Option<JsonType>,

    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    properties: Option<HashMap<String, JsonSchemaEntry>>,

    #[serde(rename = "enum", skip_serializing_if = "Option::is_none")]
    enum_: Option<Vec<String>>,

    // for map type
    #[serde(skip_serializing_if = "Option::is_none")]
    additional_properties: Option<Box<JsonSchemaEntry>>,

    // Set all properties to required
    #[serde(skip_serializing_if = "Option::is_none")]
    required: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    items: Option<Box<JsonSchemaEntry>>,

    #[serde(skip_serializing_if = "Option::is_none", rename = "$defs")]
    defs: Option<HashMap<String, JsonSchemaEntry>>,

    #[serde(skip_serializing_if = "Option::is_none", rename = "$ref")]
    ref_: Option<String>,
}

impl JsonSchemaEntry {
    pub fn add_property(&mut self, name: String, entry: JsonSchemaEntry) {
        if self.properties.is_none() {
            self.properties = Some(HashMap::new());
        }
        self.properties.as_mut().unwrap().insert(name, entry);
    }

    pub fn add_required(&mut self, name: String) {
        if self.required.is_none() {
            self.required = Some(Vec::new());
        }
        self.required.as_mut().unwrap().push(name);
    }
}

impl JsonSchemaEntry {
    pub fn object() -> Self {
        JsonSchemaEntry {
            type_: Some(JsonType::Object),
            ..Default::default()
        }
    }
    pub fn boolean() -> Self {
        JsonSchemaEntry {
            type_: Some(JsonType::Boolean),
            ..Default::default()
        }
    }
    pub fn number<S: Into<String>>(format: S) -> Self {
        JsonSchemaEntry {
            type_: Some(JsonType::Number),
            format: Some(format.into()),
            ..Default::default()
        }
    }
    pub fn string() -> Self {
        JsonSchemaEntry {
            type_: Some(JsonType::String),
            ..Default::default()
        }
    }

    pub fn string_with_format<S: Into<String>>(format: S) -> Self {
        JsonSchemaEntry {
            type_: Some(JsonType::String),
            format: Some(format.into()),
            ..Default::default()
        }
    }
    pub fn reference<S: AsRef<str>>(ref_: S) -> Self {
        JsonSchemaEntry {
            ref_: Some(format!("#/$defs/{}", ref_.as_ref())),
            ..Default::default()
        }
    }
    pub fn root_reference() -> Self{
        JsonSchemaEntry {
            ref_: Some("#".to_string()),
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
            type_: Some(JsonType::String),
            enum_: Some(enums),
            ..Default::default()
        }
    }

    pub fn map(value_type: JsonSchemaEntry) -> Self {
        JsonSchemaEntry {
            type_: Some(JsonType::Object),
            additional_properties: Some(Box::new(value_type)),
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
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
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
