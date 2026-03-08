pub mod connection_or_tx;
pub mod error;
pub mod migrate;
pub mod util;

// Re-export key types for convenience
pub use connection_or_tx::ConnectionOrTx;
pub use error::{Error, Result};
pub use migrate::run_migrations;
pub use util::{generate_id, generate_id_of_length, generate_prefixed_id};

// Re-export pool types that consumers will need
pub use r2d2;
pub use r2d2_sqlite;
pub use rusqlite;
