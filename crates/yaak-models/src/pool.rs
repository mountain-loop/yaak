//! One way in and out of a connection pool, so every acquisition is timed the same way.
//!
//! A pool that cannot hand out a connection fails with a timeout and nothing else: r2d2
//! reports `Error(None)` whether all the connections are checked out or none could be
//! opened in the first place. Those have nothing to do with each other, so the state of
//! the pool at the moment it gave up rides along in the error and in the log line.

use crate::error::{Error, Result};
use log::warn;
use std::time::{Duration, Instant};
use yaak_database::{SqliteConn, SqlitePool, pool_status};

/// Long enough that a healthy app never logs, short enough to catch a pool going bad
/// well before the acquire timeout turns it into an error.
const SLOW_ACQUIRE: Duration = Duration::from_secs(1);

pub(crate) fn acquire(pool: &SqlitePool, what: &'static str) -> Result<SqliteConn> {
    let started = Instant::now();
    let result = pool.get();
    let waited = started.elapsed();

    match result {
        Ok(conn) => {
            if waited >= SLOW_ACQUIRE {
                warn!(
                    "Waited {}ms for a {what} connection ({})",
                    waited.as_millis(),
                    pool_status(pool)
                );
            }
            Ok(conn)
        }
        Err(source) => {
            let status = pool_status(pool);
            warn!(
                "Gave up after {}ms waiting for a {what} connection ({status})",
                waited.as_millis()
            );
            Err(Error::PoolTimeout {
                what,
                waited_ms: waited.as_millis(),
                connections: status.connections,
                idle: status.idle,
                source,
            })
        }
    }
}
