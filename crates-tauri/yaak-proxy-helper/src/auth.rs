//! Who is on the other end of the socket. The kernel says which process connected, by its
//! audit token, and Security.framework says whether that process is the proxy app signed by
//! [`crate::TEAM_ID`]. The token, unlike a pid, cannot be recycled for another process
//! between the two.

use core_foundation::base::TCFType;
use core_foundation::data::CFData;
use security_framework::os::macos::code_signing::{Flags, GuestAttributes, SecCode, SecRequirement};
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;
use std::str::FromStr;

/// The process that connected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Peer {
    pub pid: i32,
    /// Its `audit_token_t`.
    pub audit_token: [u8; 32],
}

impl Peer {
    pub fn of(stream: &UnixStream) -> Result<Self, String> {
        let fd = stream.as_raw_fd();
        let mut pid: libc::pid_t = 0;
        let mut len = std::mem::size_of::<libc::pid_t>() as libc::socklen_t;
        // SAFETY: `pid` and `len` describe a buffer the size LOCAL_PEERPID writes.
        let rc = unsafe {
            libc::getsockopt(
                fd,
                libc::SOL_LOCAL,
                libc::LOCAL_PEERPID,
                (&mut pid as *mut libc::pid_t).cast(),
                &mut len,
            )
        };
        if rc != 0 {
            return Err(format!("Failed to read the peer pid: {}", std::io::Error::last_os_error()));
        }
        let mut audit_token = [0u8; 32];
        let mut len = audit_token.len() as libc::socklen_t;
        // SAFETY: as above, for the 32-byte audit_token_t LOCAL_PEERTOKEN writes.
        let rc = unsafe {
            libc::getsockopt(
                fd,
                libc::SOL_LOCAL,
                libc::LOCAL_PEERTOKEN,
                audit_token.as_mut_ptr().cast(),
                &mut len,
            )
        };
        if rc != 0 || len as usize != audit_token.len() {
            return Err(format!(
                "Failed to read the peer's audit token: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(Self { pid, audit_token })
    }
}

/// Decides whether a peer may use the daemon.
pub trait Verifier: Send + Sync {
    fn verify(&self, peer: &Peer) -> Result<(), String>;
}

/// The real check: the peer's code signature against [`crate::code_requirement`].
pub struct CodeSignature {
    requirement: String,
}

impl Default for CodeSignature {
    fn default() -> Self {
        Self { requirement: crate::code_requirement() }
    }
}

impl Verifier for CodeSignature {
    fn verify(&self, peer: &Peer) -> Result<(), String> {
        let refused = |why: String| format!("Refused pid {}: {why}", peer.pid);
        let token = CFData::from_buffer(&peer.audit_token);
        let mut attributes = GuestAttributes::new();
        attributes.set_audit_token(token.as_concrete_TypeRef());
        let code = SecCode::copy_guest_with_attribues(None, &attributes, Flags::NONE)
            .map_err(|e| refused(format!("no code object ({e})")))?;
        let requirement = SecRequirement::from_str(&self.requirement)
            .map_err(|e| format!("Invalid code requirement: {e}"))?;
        code.check_validity(Flags::NONE, &requirement)
            .map_err(|e| refused(format!("not Yaak Proxy signed by {} ({e})", crate::TEAM_ID)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_peer_and_refuses_code_not_signed_as_the_app() {
        // This test binary is the peer: at most ad-hoc signed, never the proxy app.
        let (a, _b) = UnixStream::pair().unwrap();
        let peer = Peer::of(&a).unwrap();
        assert_eq!(peer.pid, std::process::id() as i32);
        assert_ne!(peer.audit_token, [0; 32]);
        let err = CodeSignature::default().verify(&peer).unwrap_err();
        assert!(err.starts_with(&format!("Refused pid {}", peer.pid)), "{err}");
    }

    #[test]
    fn a_requirement_naming_another_team_refuses_too() {
        let (a, _b) = UnixStream::pair().unwrap();
        let peer = Peer::of(&a).unwrap();
        let verifier = CodeSignature {
            requirement: "anchor apple generic and identifier \"app.yaak.proxy\" and certificate leaf[subject.OU] = \"AAAAAAAAAA\"".into(),
        };
        assert!(verifier.verify(&peer).is_err());
    }
}
