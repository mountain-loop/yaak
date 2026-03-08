pub mod connection_or_tx;
pub mod db_context;
pub mod error;
pub mod migrate;
pub mod traits;
pub mod update_source;
pub mod util;

// Re-export key types for convenience
pub use connection_or_tx::ConnectionOrTx;
pub use db_context::DbContext;
pub use error::{Error, Result};
pub use migrate::run_migrations;
pub use traits::{UpsertModelInfo, upsert_date};
pub use update_source::UpdateSource;
pub use util::{generate_id, generate_id_of_length, generate_prefixed_id};

// Re-export pool types that consumers will need
pub use r2d2;
pub use r2d2_sqlite;
pub use rusqlite;
pub use sea_query;
pub use sea_query_rusqlite;
