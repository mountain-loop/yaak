//! Centralized action system for Yaak.
//!
//! This crate provides a unified hub for registering and invoking actions
//! across all entry points: plugins, Tauri desktop app, CLI, deep links, and MCP server.

mod context;
mod error;
mod executor;
mod groups;
mod handler;
mod types;

pub use context::*;
pub use error::*;
pub use executor::*;
pub use groups::*;
pub use handler::*;
pub use types::*;
