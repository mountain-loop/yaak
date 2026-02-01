//! Built-in action implementations for Yaak.
//!
//! This crate provides concrete implementations of built-in actions using
//! the yaak-actions framework. It depends on domain-specific crates like
//! yaak-http, yaak-models, yaak-plugins, etc.

pub mod dependencies;
pub mod http;

pub use dependencies::BuiltinActionDependencies;
pub use http::register_http_actions;
