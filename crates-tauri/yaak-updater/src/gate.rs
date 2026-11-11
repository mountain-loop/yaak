//! One update at a time per process. Every trigger (launch, focus, a menu item, a Settings
//! button, in any window) goes through the app's [`UpdateGate`], which allows one check at a
//! time and one update run (offer, download, install) at a time, and never downloads an update
//! again once it is installed.
//!
//! A check may run while an offer waits on the user: finding the same version shows that offer
//! again, wired to the same run, and finding a newer one replaces it. Anything further along,
//! downloading, installing or installed, refuses a new check, and a check the user asked for
//! is shown where things stand instead.

use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use ts_rs::TS;

use crate::UpdateInfo;

/// Where this process's update stands.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase", tag = "state")]
#[ts(export, export_to = "index.ts")]
pub enum UpdateState {
    #[default]
    Idle,
    /// Asking the update server
    Checking,
    /// Offered, and waiting for the user to choose
    Offered {
        version: String,
    },
    Downloading {
        version: String,
    },
    Installing {
        version: String,
    },
    /// Installed; it runs once the app relaunches
    Installed {
        version: String,
    },
}

/// The app's one update gate, kept in its state and shared by every window.
#[derive(Clone, Default)]
pub struct UpdateGate(Arc<Mutex<Gate>>);

impl UpdateGate {
    /// Where the update stands now.
    pub fn state(&self) -> UpdateState {
        self.lock().current()
    }

    /// Claims the gate for a check, or says why not. The claim ends when the token is dropped,
    /// or hands over to a run with [`crate::offer_update`].
    pub fn begin_check(&self) -> Result<CheckToken, Busy> {
        let mut gate = self.lock();
        match gate.begin_check() {
            Ok(()) => Ok(CheckToken { gate: self.clone(), ended: false }),
            Err(state) => Err(Busy::new(state, gate.offer.clone()).with_gate(self.clone())),
        }
    }

    pub(crate) fn lock(&self) -> MutexGuard<'_, Gate> {
        // A panic mid-transition leaves the last state set, which is still the truth
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// A check refused, with where the update stands, to show the user who asked.
#[derive(Clone)]
pub struct Busy {
    pub state: UpdateState,
    /// The prompt on offer, to show again, wired to the run that waits for it
    pub(crate) offer: Option<UpdateInfo>,
    /// The gate, to note the windows the prompt is shown in again
    pub(crate) gate: Option<UpdateGate>,
}

impl Busy {
    pub(crate) fn new(state: UpdateState, offer: Option<UpdateInfo>) -> Self {
        Self { state, offer, gate: None }
    }

    pub(crate) fn with_gate(mut self, gate: UpdateGate) -> Self {
        self.gate = Some(gate);
        self
    }
}

impl std::fmt::Debug for Busy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Busy").field("state", &self.state).field("offer", &self.offer).finish()
    }
}

impl PartialEq for Busy {
    fn eq(&self, other: &Self) -> bool {
        self.state == other.state && self.offer == other.offer
    }
}

/// The one check in flight. Dropping it, as a failed or empty check does, frees the gate.
pub struct CheckToken {
    pub(crate) gate: UpdateGate,
    /// Ended by an offer already, so dropping it mustn't end the next check
    pub(crate) ended: bool,
}

impl Drop for CheckToken {
    fn drop(&mut self) {
        if !self.ended {
            self.gate.lock().checking = false;
        }
    }
}

/// What a check that found `version` does.
#[derive(Debug, PartialEq)]
pub(crate) enum OfferDecision {
    /// Start run `run`; the one it replaces, if any, was cancelled
    Start { run: u64 },
    /// The same version is on offer already: show its prompt again
    Reshow(UpdateInfo),
    /// The run moved on (the user chose to install meanwhile): start nothing
    Busy(Busy),
}

/// The gate's state, behind its lock.
#[derive(Default)]
pub(crate) struct Gate {
    /// A check is in flight
    checking: bool,
    /// The current run's id; a run that is no longer current changes nothing
    run: u64,
    /// The current run's state, Idle when there is none
    state: UpdateState,
    /// The prompt the current run shows, while it waits on the user
    offer: Option<UpdateInfo>,
    /// Cancels the current run while it waits on the user, so a newer version can replace it.
    /// Kept through a background download, which returns to waiting on the user.
    cancel: Option<Box<dyn FnOnce() + Send>>,
    /// The windows showing the current run's prompt, each told when it installs. A run that
    /// replaces another takes over its windows, so none is left with a stale prompt.
    windows: Vec<String>,
    /// The current run's prompt was withdrawn for a native dialog, which nothing may cancel
    withdrawn: bool,
}

impl Gate {
    /// What the user is shown for "where does the update stand".
    pub(crate) fn current(&self) -> UpdateState {
        if self.checking && self.state == UpdateState::Idle {
            UpdateState::Checking
        } else {
            self.state.clone()
        }
    }

    pub(crate) fn begin_check(&mut self) -> Result<(), UpdateState> {
        if self.checking {
            return Err(self.current());
        }
        match self.state {
            UpdateState::Idle | UpdateState::Offered { .. } => {
                self.checking = true;
                Ok(())
            }
            ref state => Err(state.clone()),
        }
    }

    /// A check from window `label` found `version`. Ends the check, and decides whether a run
    /// starts.
    pub(crate) fn offer(&mut self, version: &str, label: &str) -> OfferDecision {
        self.checking = false;
        let windows = match &self.state {
            UpdateState::Idle => Vec::new(),
            UpdateState::Offered { version: offered } if offered == version => {
                if let Some(info) = self.offer.clone() {
                    self.add_window(label);
                    return OfferDecision::Reshow(info);
                }
                // Not shown yet (the run is still preparing its prompt): nothing to add
                return OfferDecision::Busy(Busy::new(self.state.clone(), None));
            }
            UpdateState::Offered { .. } if self.cancel.is_some() => {
                // A newer version replaces the prompt the user hasn't taken, in every window
                // showing it
                if let Some(cancel) = self.cancel.take() {
                    cancel();
                }
                std::mem::take(&mut self.windows)
            }
            state => {
                return OfferDecision::Busy(Busy::new(state.clone(), None));
            }
        };
        self.run += 1;
        self.state = UpdateState::Offered { version: version.to_string() };
        self.offer = None;
        self.cancel = None;
        self.withdrawn = false;
        self.windows = windows;
        self.add_window(label);
        OfferDecision::Start { run: self.run }
    }

    /// Moves run `run` to `state`. False, changing nothing, when the run is no longer current.
    pub(crate) fn advance(&mut self, run: u64, state: UpdateState) -> bool {
        if run != self.run {
            return false;
        }
        if !matches!(state, UpdateState::Offered { .. }) {
            // Not waiting on the user now: no prompt to show again until it waits once more
            self.offer = None;
        }
        self.state = state;
        true
    }

    /// Run `run` shows `info` in window `label` and waits on the user.
    pub(crate) fn offered(&mut self, run: u64, info: UpdateInfo, label: &str) -> bool {
        if !self.advance(run, UpdateState::Offered { version: info.version.clone() }) {
            return false;
        }
        self.offer = Some(info);
        self.add_window(label);
        true
    }

    /// The current run's prompt is showing in window `label` too.
    pub(crate) fn add_window(&mut self, label: &str) {
        if !self.windows.iter().any(|w| w == label) {
            self.windows.push(label.to_string());
        }
    }

    /// The windows showing run `run`'s prompt.
    pub(crate) fn windows(&self, run: u64) -> Vec<String> {
        if run == self.run { self.windows.clone() } else { Vec::new() }
    }

    /// The prompt is gone (the window didn't answer, so a native dialog asks instead): nothing
    /// can show it again, and a newer version mustn't cancel the dialog's install.
    pub(crate) fn withdraw_offer(&mut self, run: u64) {
        if run == self.run {
            self.offer = None;
            self.cancel = None;
            self.withdrawn = true;
        }
    }

    /// Registers how to cancel run `run`. Its task may already have moved on, into a background
    /// download, by the time this is called; the handle is kept all the same, and only used
    /// while the run waits on the user.
    pub(crate) fn set_cancel(&mut self, run: u64, cancel: Box<dyn FnOnce() + Send>) {
        if run == self.run && !self.withdrawn {
            self.cancel = Some(cancel);
        }
    }

    /// Run `run` ended. Unless it installed, which stays until the app relaunches, the gate is
    /// free again.
    pub(crate) fn finish(&mut self, run: u64) {
        if run != self.run || matches!(self.state, UpdateState::Installed { .. }) {
            return;
        }
        self.state = UpdateState::Idle;
        self.offer = None;
        self.cancel = None;
        self.windows.clear();
    }
}

/// The current run's hold on the gate, kept by its task. Dropping it ends the run.
pub(crate) struct RunGuard {
    pub(crate) gate: UpdateGate,
    pub(crate) run: u64,
}

impl RunGuard {
    /// Moves the run on. False when a newer run replaced it, and it should stop.
    pub(crate) fn advance(&self, state: UpdateState) -> bool {
        self.gate.lock().advance(self.run, state)
    }

    pub(crate) fn offered(&self, info: UpdateInfo, label: &str) -> bool {
        self.gate.lock().offered(self.run, info, label)
    }

    /// The windows showing this run's prompt.
    pub(crate) fn windows(&self) -> Vec<String> {
        self.gate.lock().windows(self.run)
    }

    pub(crate) fn withdraw_offer(&self) {
        self.gate.lock().withdraw_offer(self.run);
    }
}

impl Drop for RunGuard {
    fn drop(&mut self) {
        self.gate.lock().finish(self.run);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    fn version(v: &str) -> String {
        v.to_string()
    }

    fn info(v: &str, reply: &str) -> UpdateInfo {
        UpdateInfo { reply_event_id: reply.into(), version: v.into(), ..Default::default() }
    }

    fn started(decision: OfferDecision) -> u64 {
        match decision {
            OfferDecision::Start { run } => run,
            other => panic!("expected a run to start, got {other:?}"),
        }
    }

    #[test]
    fn overlapping_checks_run_one_at_a_time() {
        let mut gate = Gate::default();
        assert_eq!(gate.begin_check(), Ok(()));
        assert_eq!(gate.current(), UpdateState::Checking);
        // A second trigger, background or the user's, from any window
        assert_eq!(gate.begin_check(), Err(UpdateState::Checking));
    }

    #[test]
    fn a_check_finding_nothing_frees_the_gate() {
        let gate = UpdateGate::default();
        let token = gate.begin_check().unwrap();
        assert!(gate.begin_check().is_err());
        drop(token);
        assert_eq!(gate.state(), UpdateState::Idle);
        assert!(gate.begin_check().is_ok());
    }

    #[test]
    fn checks_wait_while_downloading_and_installing() {
        let mut gate = Gate::default();
        gate.begin_check().unwrap();
        let run = started(gate.offer("2.0.0", "main_0"));
        assert!(gate.offered(run, info("2.0.0", "r1"), "main_0"));

        assert!(gate.advance(run, UpdateState::Downloading { version: version("2.0.0") }));
        assert_eq!(gate.begin_check(), Err(UpdateState::Downloading { version: version("2.0.0") }));
        assert!(gate.advance(run, UpdateState::Installing { version: version("2.0.0") }));
        assert_eq!(gate.begin_check(), Err(UpdateState::Installing { version: version("2.0.0") }));
    }

    #[test]
    fn an_installed_update_is_never_downloaded_again() {
        let mut gate = Gate::default();
        gate.begin_check().unwrap();
        let run = started(gate.offer("2.0.0", "main_0"));
        assert!(gate.advance(run, UpdateState::Installed { version: version("2.0.0") }));
        // The run's task ends; the install stands until the app relaunches
        gate.finish(run);
        assert_eq!(gate.current(), UpdateState::Installed { version: version("2.0.0") });
        assert_eq!(gate.begin_check(), Err(UpdateState::Installed { version: version("2.0.0") }));
    }

    #[test]
    fn the_same_version_found_again_shows_the_same_prompt() {
        let mut gate = Gate::default();
        gate.begin_check().unwrap();
        let run = started(gate.offer("2.0.0", "main_0"));
        assert!(gate.offered(run, info("2.0.0", "r1"), "main_0"));

        // Another window's check, while the prompt waits
        assert_eq!(gate.begin_check(), Ok(()));
        assert_eq!(gate.offer("2.0.0", "main_0"), OfferDecision::Reshow(info("2.0.0", "r1")));
        // Still the one run, still waiting
        assert_eq!(gate.current(), UpdateState::Offered { version: version("2.0.0") });
        assert!(gate.advance(run, UpdateState::Downloading { version: version("2.0.0") }));
    }

    #[test]
    fn a_newer_version_replaces_an_offer_not_taken() {
        let mut gate = Gate::default();
        gate.begin_check().unwrap();
        let first = started(gate.offer("2.0.0", "main_0"));
        assert!(gate.offered(first, info("2.0.0", "r1"), "main_0"));
        let cancelled = Arc::new(AtomicBool::new(false));
        let flag = cancelled.clone();
        gate.set_cancel(first, Box::new(move || flag.store(true, Ordering::SeqCst)));

        gate.begin_check().unwrap();
        let second = started(gate.offer("2.1.0", "main_0"));
        assert!(cancelled.load(Ordering::SeqCst), "the first run is cancelled");
        assert_ne!(first, second);

        // The replaced run can no longer move the gate, nor free it as it ends
        assert!(!gate.advance(first, UpdateState::Downloading { version: version("2.0.0") }));
        gate.finish(first);
        assert_eq!(gate.current(), UpdateState::Offered { version: version("2.1.0") });
    }

    #[test]
    fn a_newer_version_replaces_an_offer_after_its_background_download() {
        let mut gate = Gate::default();
        gate.begin_check().unwrap();
        let first = started(gate.offer("2.0.0", "main_0"));
        let cancelled = Arc::new(AtomicBool::new(false));
        let flag = cancelled.clone();
        gate.set_cancel(first, Box::new(move || flag.store(true, Ordering::SeqCst)));
        // A background check downloads first, then waits on the user with its prompt
        assert!(gate.advance(first, UpdateState::Downloading { version: version("2.0.0") }));
        assert!(gate.advance(first, UpdateState::Offered { version: version("2.0.0") }));
        assert!(gate.offered(first, info("2.0.0", "r1"), "main_0"));

        gate.begin_check().unwrap();
        let second = started(gate.offer("2.1.0", "main_0"));
        assert!(cancelled.load(Ordering::SeqCst), "the downloaded offer is replaced");
        assert_ne!(first, second);
    }

    #[test]
    fn every_window_showing_the_prompt_hears_it_installed() {
        let gate = UpdateGate::default();
        let token = gate.begin_check().unwrap();
        let run = started(gate.lock().offer("2.0.0", "main_0"));
        drop(token);
        assert!(gate.lock().offered(run, info("2.0.0", "r1"), "main_0"));

        // Settings checks and is shown the same prompt; so is a window refused mid-check
        gate.begin_check().unwrap();
        assert!(matches!(gate.lock().offer("2.0.0", "settings"), OfferDecision::Reshow(_)));
        let in_flight = gate.begin_check().unwrap();
        let busy = gate.begin_check().err().unwrap();
        if let Some(g) = &busy.gate {
            g.lock().add_window("main_1");
        }
        drop(in_flight);
        // Shown again in the main window adds nothing new
        gate.lock().add_window("main_0");
        assert_eq!(gate.lock().windows(run), vec!["main_0", "settings", "main_1"]);

        // A newer run takes over every window showing the old prompt, and the one that found it
        gate.begin_check().unwrap();
        gate.lock().set_cancel(run, Box::new(|| {}));
        let next = started(gate.lock().offer("2.1.0", "main_2"));
        assert_eq!(gate.lock().windows(next), vec!["main_0", "settings", "main_1", "main_2"]);
        assert!(gate.lock().windows(run).is_empty(), "the old run has no windows left");
    }

    #[test]
    fn a_fresh_run_starts_with_the_window_that_found_it() {
        let mut gate = Gate::default();
        gate.begin_check().unwrap();
        let run = started(gate.offer("2.0.0", "settings"));
        assert_eq!(gate.windows(run), vec!["settings"]);
        // Its task fails or the user skips: the next run starts afresh
        gate.finish(run);
        gate.begin_check().unwrap();
        let next = started(gate.offer("2.0.0", "main_0"));
        assert_eq!(gate.windows(next), vec!["main_0"]);
    }

    #[test]
    fn a_cancel_registered_after_a_background_download_began_is_kept() {
        let mut gate = Gate::default();
        gate.begin_check().unwrap();
        let first = started(gate.offer("2.0.0", "main_0"));
        // The task starts downloading on another worker before its cancel is registered
        assert!(gate.advance(first, UpdateState::Downloading { version: version("2.0.0") }));
        let cancelled = Arc::new(AtomicBool::new(false));
        let flag = cancelled.clone();
        gate.set_cancel(first, Box::new(move || flag.store(true, Ordering::SeqCst)));
        assert!(gate.advance(first, UpdateState::Offered { version: version("2.0.0") }));
        assert!(gate.offered(first, info("2.0.0", "r1"), "main_0"));

        gate.begin_check().unwrap();
        started(gate.offer("2.1.0", "main_0"));
        assert!(cancelled.load(Ordering::SeqCst), "a newer version still replaces it");
    }

    #[test]
    fn a_cancel_registered_after_the_prompt_was_withdrawn_is_refused() {
        let mut gate = Gate::default();
        gate.begin_check().unwrap();
        let run = started(gate.offer("2.0.0", "main_0"));
        gate.withdraw_offer(run);
        gate.set_cancel(run, Box::new(|| panic!("the native dialog's run was cancelled")));
        gate.begin_check().unwrap();
        assert!(matches!(gate.offer("2.1.0", "main_0"), OfferDecision::Busy(_)));
    }

    #[test]
    fn a_check_that_finds_the_user_installing_starts_nothing() {
        let mut gate = Gate::default();
        gate.begin_check().unwrap();
        let run = started(gate.offer("2.0.0", "main_0"));
        assert!(gate.offered(run, info("2.0.0", "r1"), "main_0"));

        // A check starts while the prompt waits, then the user chooses Install
        gate.begin_check().unwrap();
        assert!(gate.advance(run, UpdateState::Downloading { version: version("2.0.0") }));
        match gate.offer("2.0.0", "main_0") {
            OfferDecision::Busy(busy) => {
                assert_eq!(busy.state, UpdateState::Downloading { version: version("2.0.0") });
                assert_eq!(busy.offer, None);
            }
            other => panic!("expected busy, got {other:?}"),
        }
        assert!(!gate.checking);
    }

    #[test]
    fn a_run_that_ends_without_installing_frees_the_gate() {
        let mut gate = Gate::default();
        gate.begin_check().unwrap();
        let run = started(gate.offer("2.0.0", "main_0"));
        assert!(gate.advance(run, UpdateState::Downloading { version: version("2.0.0") }));
        // The download or install failed, or the user skipped it
        gate.finish(run);
        assert_eq!(gate.current(), UpdateState::Idle);
        assert_eq!(gate.begin_check(), Ok(()));
    }

    #[test]
    fn a_withdrawn_prompt_is_not_shown_again() {
        let mut gate = Gate::default();
        gate.begin_check().unwrap();
        let run = started(gate.offer("2.0.0", "main_0"));
        assert!(gate.offered(run, info("2.0.0", "r1"), "main_0"));
        gate.set_cancel(run, Box::new(|| panic!("the dialog's run was cancelled")));
        // The window never answered, so the native dialog took over
        gate.withdraw_offer(run);
        gate.begin_check().unwrap();
        match gate.offer("2.0.0", "main_0") {
            OfferDecision::Busy(busy) => {
                assert_eq!(busy.state, UpdateState::Offered { version: version("2.0.0") })
            }
            other => panic!("expected busy, got {other:?}"),
        }
        // Nor does a newer version cancel the dialog, which may be installing
        gate.begin_check().unwrap();
        assert!(matches!(gate.offer("2.1.0", "main_0"), OfferDecision::Busy(_)));
    }

    #[test]
    fn a_busy_check_carries_the_prompt_to_show_again() {
        let gate = UpdateGate::default();
        let token = gate.begin_check().unwrap();
        let run = started(gate.lock().offer("2.0.0", "main_0"));
        drop(token);
        assert!(gate.lock().offered(run, info("2.0.0", "r1"), "main_0"));

        // One check in flight while the prompt waits; a second trigger is refused, carrying
        // the prompt so the user who asked sees it rather than a new one
        let first = gate.begin_check().unwrap();
        let busy = match gate.begin_check() {
            Err(busy) => busy,
            Ok(_) => panic!("a second check in flight"),
        };
        assert_eq!(busy.state, UpdateState::Offered { version: version("2.0.0") });
        assert_eq!(busy.offer, Some(info("2.0.0", "r1")));
        drop(first);
    }
}
