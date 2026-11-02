//! Telling whether the process that turned the system proxy on is still the same process. A
//! pid alone is not enough once it can be reused, after a reboot for one, so the owner is the
//! pid and the time it started.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Owner {
    pub pid: i32,
    /// Microseconds since the epoch.
    pub started: u64,
}

pub trait Processes {
    /// When `pid` started, while it runs.
    fn start_time(&self, pid: i32) -> Option<u64>;

    fn owner(&self, pid: i32) -> Option<Owner> {
        Some(Owner { pid, started: self.start_time(pid)? })
    }

    fn is_alive(&self, owner: &Owner) -> bool {
        self.start_time(owner.pid) == Some(owner.started)
    }
}

/// This Mac's processes, through `proc_pidinfo`.
pub struct SystemProcesses;

impl Processes for SystemProcesses {
    fn start_time(&self, pid: i32) -> Option<u64> {
        if pid <= 0 {
            return None;
        }
        let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
        // SAFETY: `info` is a buffer of exactly `size` bytes for PROC_PIDTBSDINFO to fill.
        let written = unsafe {
            libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, info.as_mut_ptr().cast(), size)
        };
        if written != size {
            return None;
        }
        // SAFETY: proc_pidinfo filled the whole struct.
        let info = unsafe { info.assume_init() };
        // A zombie has exited; only its parent has yet to notice.
        if info.pbi_status == libc::SZOMB {
            return None;
        }
        Some(info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_this_process_and_not_a_missing_one() {
        let me = SystemProcesses.owner(std::process::id() as i32).unwrap();
        assert!(SystemProcesses.is_alive(&me));
        // Same pid, different start: the pid was reused.
        assert!(!SystemProcesses.is_alive(&Owner { started: me.started + 1, ..me }));
        assert_eq!(SystemProcesses.start_time(0), None);
        assert_eq!(SystemProcesses.start_time(i32::MAX), None);
    }

    #[test]
    fn a_child_that_exited_is_not_alive() {
        let mut child = std::process::Command::new("/usr/bin/true").spawn().unwrap();
        let owner = SystemProcesses.owner(child.id() as i32);
        child.wait().unwrap();
        if let Some(owner) = owner {
            assert!(!SystemProcesses.is_alive(&owner));
        }
    }
}
