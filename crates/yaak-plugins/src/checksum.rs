use sha2::{Digest, Sha256};

pub(crate) fn compute_checksum(bytes: impl AsRef<[u8]>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let hash = hasher.finalize();
    hex::encode(hash)
}
