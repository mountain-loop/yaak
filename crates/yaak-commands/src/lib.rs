//! Command handlers for the RPC surface, written against [`Host`] instead of
//! any particular host.
//!
//! `yaak_rpc_schema` declares what each command is called and what it takes
//! and returns; this crate is where the bodies live. Every handler has the
//! shape the router wants — `async fn(host, Req) -> Result<Res>` — so a host
//! registers one with a one-line adapter (or none at all), and never
//! redeclares a command.
//!
//! Not every command is here yet. Handlers move in as they are freed of
//! host-specific types; the ones that stay behind are the ones only a desktop
//! can serve (native windows, the updater, dialogs) or that still lean on it.

pub mod actions;
pub mod auth;
pub mod data;
pub mod encryption;
pub mod error;
pub mod host;
pub mod models;
pub mod plugins;
pub mod render;
pub mod resolve;
pub mod responses;
pub mod templates;

pub use error::{Error, Result};
pub use host::{Host, PluginHost};
