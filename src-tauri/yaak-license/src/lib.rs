use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
    Runtime,
};

mod commands;
mod errors;
mod license;

use crate::commands::{activate, check};
pub use license::*;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-license").invoke_handler(generate_handler![check, activate]).build()
}
