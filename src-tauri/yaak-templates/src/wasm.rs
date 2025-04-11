use crate::error::Result;
use crate::Parser;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::JsValue;

#[wasm_bindgen]
pub fn parse_template(template: &str) -> Result<JsValue> {
    let tokens = Parser::new(template).parse()?;
    Ok(serde_wasm_bindgen::to_value(&tokens).unwrap())
}