//! Keeps background database work from running into SQLCipher's teardown as the process exits.
//!
//! SQLCipher frees its global state (the key shield, its private heap) in an `atexit` handler it
//! registers the first time a database is keyed. A thread still reading or writing a database,
//! or closing its last connection, then crashes inside SQLCipher. The threads this crate starts
//! (the event loop writing flows, deleting cleared flows, keeping traffic under its cap) hold
//! [`hold`] around each unit of work. [`install`], called once a database is open and so after
//! SQLCipher's handler, registers one that runs before it, as handlers run last registered
//! first: it stops any more work starting, waits for work in flight to finish, for a few seconds
//! at most, and lets the process exit with that work parked.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Once, RwLock, RwLockReadGuard, TryLockError};
use std::time::{Duration, Instant};

static GATE: RwLock<()> = RwLock::new(());
/// Set as the process exits: no more work starts.
static EXITING: AtomicBool = AtomicBool::new(false);
static INSTALL: Once = Once::new();

/// The longest the exit handler waits for work in flight before letting the process go on
/// exiting regardless, so a stuck thread never hangs a quit.
const EXIT_WAIT: Duration = Duration::from_secs(5);

/// Held around a unit of background database work, a batch, closing connections included. Once
/// the process is exiting, this parks the thread for good instead: the work never starts.
pub(crate) fn hold() -> RwLockReadGuard<'static, ()> {
    if EXITING.load(Ordering::SeqCst) {
        loop {
            std::thread::park();
        }
    }
    GATE.read().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Registers the exit handler, once per process. Call after a database is open, so SQLCipher's
/// own handler is registered first and runs after this one.
pub(crate) fn install() {
    INSTALL.call_once(|| {
        // SAFETY: `close_gate` is an `extern "C" fn()` that never unwinds.
        let failed = unsafe { atexit(close_gate) } != 0;
        if failed {
            log::warn!("Failed to register the database exit handler");
        }
    });
}

unsafe extern "C" {
    fn atexit(callback: extern "C" fn()) -> std::ffi::c_int;
}

/// Stops more work starting, then waits for the work in flight to finish its batch and keeps
/// the gate shut for the rest of the process's life.
extern "C" fn close_gate() {
    EXITING.store(true, Ordering::SeqCst);
    wait_for_work(EXIT_WAIT);
}

/// Takes the gate for good once no work holds it, or gives up after `wait`. Returns whether it
/// was taken. Polled, as a blocking write can't be given up on; with no new work starting, the
/// work in flight can't starve it.
fn wait_for_work(wait: Duration) -> bool {
    let deadline = Instant::now() + wait;
    loop {
        match GATE.try_write() {
            Ok(guard) => {
                std::mem::forget(guard);
                return true;
            }
            Err(TryLockError::Poisoned(e)) => {
                std::mem::forget(e.into_inner());
                return true;
            }
            Err(TryLockError::WouldBlock) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(1));
            }
            Err(TryLockError::WouldBlock) => return false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::mpsc::channel;

    const SELF: &str = "exit_gate::tests::exiting_waits_for_work_in_flight_and_starts_no_more";

    /// A batch in flight finishes before the gate shuts, however busy other work keeps it, and
    /// no work starts after. Run in a process of its own, as shutting the gate parks every
    /// thread that would hold it, which the other tests' threads would be.
    #[test]
    fn exiting_waits_for_work_in_flight_and_starts_no_more() {
        if std::env::var("YAAK_EXIT_GATE_CHILD").is_err() {
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", SELF, "--test-threads", "1"])
                .env("YAAK_EXIT_GATE_CHILD", "1")
                .status()
                .unwrap();
            assert!(status.success());
            return;
        }

        // Busy work, taking the gate again as soon as it lets go, as the event loop does.
        let busy = Arc::new(AtomicBool::new(false));
        for _ in 0..4 {
            let busy = busy.clone();
            std::thread::spawn(move || {
                loop {
                    let _held = hold();
                    busy.store(true, Ordering::SeqCst);
                }
            });
        }
        // A batch in flight, a slow one.
        let (holding_tx, holding_rx) = channel();
        let (finished_tx, finished_rx) = channel();
        std::thread::spawn(move || {
            let _batch = hold();
            holding_tx.send(()).unwrap();
            std::thread::sleep(Duration::from_millis(200));
            finished_tx.send(Instant::now()).unwrap();
        });
        holding_rx.recv().unwrap();
        while !busy.load(Ordering::SeqCst) {
            std::hint::spin_loop();
        }

        EXITING.store(true, Ordering::SeqCst);
        assert!(wait_for_work(Duration::from_secs(5)), "not starved by the busy work");
        let finished = finished_rx.try_recv().expect("the batch finished before the gate shut");
        assert!(finished <= Instant::now());
        // Nothing holds the gate after, the busy work included: it is all parked.
        assert!(GATE.try_read().is_err(), "shut for good");
    }
}
