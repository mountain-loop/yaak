//! JSONPath (jsonpath-plus, with RFC 9535 additions) and XPath 1.0 filtering
//! of response text.

mod jsonpath;
mod xml;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    JsonPath,
    XPath,
}

impl Language {
    /// XML and HTML bodies take XPath; everything else is treated as JSON.
    pub fn for_content_type(content_type: &str) -> Self {
        let content_type = content_type.to_lowercase();
        if content_type.contains("xml") || content_type.contains("html") {
            Language::XPath
        } else {
            Language::JsonPath
        }
    }
}

/// The filtered text, or an empty string and the reason it could not be filtered.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FilterResult {
    pub content: String,
    pub error: Option<String>,
}

impl FilterResult {
    fn from_result(result: Result<String, String>) -> Self {
        match result {
            Ok(content) => FilterResult { content, error: None },
            Err(error) => FilterResult { content: String::new(), error: Some(error) },
        }
    }
}

pub fn filter(language: Language, text: &str, query: &str) -> FilterResult {
    match language {
        Language::JsonPath => json_path(text, query),
        Language::XPath => xpath(text, query),
    }
}

/// Every match, as a pretty-printed JSON array.
pub fn json_path(text: &str, query: &str) -> FilterResult {
    FilterResult::from_result(jsonpath::evaluate(text, query))
}

/// Matched nodes serialized as XML, one per line, or the string form of a
/// number, string, or boolean result.
pub fn xpath(text: &str, query: &str) -> FilterResult {
    FilterResult::from_result(xml::evaluate(text, query))
}
