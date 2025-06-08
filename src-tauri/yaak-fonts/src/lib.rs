use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
    Runtime,
};

mod commands;
mod error;

use crate::commands::list;
pub use error::{Error, Result};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-fonts").invoke_handler(generate_handler![list]).build()
}
