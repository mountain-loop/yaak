use crate::error::Result;
use crate::{escape, Parser};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::JsValue;

#[wasm_bindgen]
pub fn parse_template(template: &str) -> Result<JsValue> {
    let tokens = Parser::new(template).parse()?;
    Ok(serde_wasm_bindgen::to_value(&tokens).unwrap())
}

#[wasm_bindgen]
pub fn escape_template(template: &str) -> Result<JsValue> {
    let escaped = escape::escape_template(template);
    Ok(serde_wasm_bindgen::to_value(&escaped).unwrap())
}

#[wasm_bindgen]
pub fn unescape_template(template: &str) -> Result<JsValue> {
    let escaped = escape::unescape_template(template);
    Ok(serde_wasm_bindgen::to_value(&escaped).unwrap())
}
