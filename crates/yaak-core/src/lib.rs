//! Core abstractions for Yaak that work without Tauri.
//!
//! This crate provides foundational types and traits that allow Yaak's
//! business logic to run in both Tauri (desktop app) and CLI contexts.

mod context;
mod error;

pub use context::{AppContext, WorkspaceContext};
pub use error::{Error, Result};
