//! The search query language of Yaak and Yaak Proxy.
//!
//! The syntax follows Datadog's log search. Terms side by side must all match; `OR` (upper
//! case) between terms or groups means either; parentheses group; `-` directly before a term or
//! group excludes it. A bare word matches the free text, a double-quoted phrase matches it with
//! its spaces kept, and `@path:value` matches a field. A value may be `*` (the field is present),
//! a `*` wildcard pattern, a comparison like `>=400` or `>500ms`, or a range like
//! `[400 TO 499]`. Everything matches case-insensitively, and nothing in the input is an error.
//!
//! [`parse`] gives the tree, which a consumer may walk to compile it elsewhere (to SQL, say).
//! [`evaluate`] runs it in memory against a [`Document`], with a [`Schema`] saying what the
//! fields are. [`tokens`], [`completions`] and [`format_field`] serve the search box. A compiler
//! resolves each field term to a [`Condition`] and translates that, so it matches as
//! [`evaluate`] does.

// The wasm-bindgen exports expand to unsafe glue; nothing else in the crate may use unsafe
#![cfg_attr(
    not(all(feature = "wasm", target_arch = "wasm32")),
    forbid(unsafe_code)
)]
#![cfg_attr(all(feature = "wasm", target_arch = "wasm32"), deny(unsafe_code))]

pub mod ast;
mod complete;
mod condition;
mod eval;
mod format;
pub mod fuzzy;
mod lexer;
mod offsets;
mod parser;
mod schema;
mod tokens;
#[cfg(all(feature = "wasm", target_arch = "wasm32"))]
#[allow(unsafe_code)]
mod wasm;

pub use ast::{CompareOp, FieldValue, Node, NumberLiteral, Span};
pub use complete::{Completion, CompletionKind, Completions, completions};
pub use condition::{Condition, contains_ignore_case, format_number, read_number, wildcard_match};
pub use eval::{DocValue, DocValues, Document, Matcher, Table, evaluate};
pub use format::{format_field, format_value, is_valid_path, quote};
pub use offsets::Utf16Offsets;
pub use parser::parse;
pub use schema::{Diagnostic, FieldDef, FieldKind, FreeText, ResolvedField, Schema, Unit};
pub use tokens::{Token, TokenKind, tokens};
