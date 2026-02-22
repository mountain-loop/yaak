//! Core plugin system for Yaak.
//!
//! This crate provides the plugin manager and supporting functionality
//! for running JavaScript plugins via a Node.js runtime.
//!
//! Note: This crate is Tauri-independent. Tauri integration is provided
//! by yaak-app's plugins_ext module.

pub mod api;
mod checksum;
pub mod error;
pub mod events;
pub mod install;
pub mod manager;
pub mod native_template_functions;
mod nodejs;
pub mod plugin_handle;
pub mod plugin_meta;
mod server_ws;
pub mod template_callback;
mod util;
