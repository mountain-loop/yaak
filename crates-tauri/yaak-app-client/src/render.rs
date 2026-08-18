//! One import path for rendering, wherever the pieces actually live.
//!
//! The request renderers are engine code; the template renderers moved to
//! `yaak-commands` when the template commands did. Callers in this crate do not
//! need to track which is which.

pub use yaak_models::render::{render_grpc_request, render_http_request};
pub use yaak_commands::render::{render_json_value, render_template};
