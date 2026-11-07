//! A key for an app's own data at rest, outside any workspace. The data key encrypts the data;
//! it is kept beside it wrapped (encrypted) by the app's master key, so only the master key
//! lives in the OS credential store.

use crate::encryption::{decrypt_data, encrypt_data};
use crate::error::Error::{GenericError, IncorrectMasterKey, MissingMasterKey};
use crate::error::Result;
use crate::master_key::{write_secret_file, MasterKey, MasterKeySource};
use base64::prelude::BASE64_STANDARD;
use base64::Engine;
use chacha20poly1305::aead::{Generate, Key};
use chacha20poly1305::XChaCha20Poly1305;
use std::fmt;
use std::fs;
use std::io;
use std::path::Path;

#[derive(Clone)]
pub struct DataKey {
    key: Key<XChaCha20Poly1305>,
}

impl DataKey {
    /// Bytes [`DataKey::encrypt`] adds to what it encrypts: a tag and version, the nonce and the
    /// authentication tag.
    pub const OVERHEAD: usize = 48;

    /// A new data key, and it wrapped by the master key in `source`, for storing. Makes the
    /// master key when `source` has none.
    pub fn create(source: &MasterKeySource) -> Result<(Self, String)> {
        let master = MasterKey::get_or_create_in(source.store())?;
        let key = Key::<XChaCha20Poly1305>::generate();
        let wrapped = BASE64_STANDARD.encode(master.encrypt(key.as_slice())?);
        Ok((Self { key }, wrapped))
    }

    /// The data key in `wrapped`, as [`DataKey::create`] gave it, unwrapped with the master key
    /// in `source`. Never makes a master key: one made now could not unwrap it.
    pub fn from_wrapped(source: &MasterKeySource, wrapped: &str) -> Result<Self> {
        let master = MasterKey::get_in(source.store())?.ok_or(MissingMasterKey)?;
        let wrapped = BASE64_STANDARD
            .decode(wrapped.trim())
            .map_err(|e| GenericError(format!("Failed to decode the wrapped data key: {e}")))?;
        let raw = master.decrypt(&wrapped).map_err(|_| IncorrectMasterKey)?;
        let key = Key::<XChaCha20Poly1305>::try_from(raw.as_slice())
            .map_err(|_| GenericError("The data key is the wrong length".to_string()))?;
        Ok(Self { key })
    }

    /// The data key kept wrapped in the file at `path`, made and written there the first time.
    /// Safe to call from several threads and processes at once: a lock beside the file
    /// serializes them, so every caller gets the one key that ends up written.
    pub fn load_or_create_file(source: &MasterKeySource, path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path.with_extension("lock"))?;
        lock.lock()?;

        match fs::read_to_string(path) {
            Ok(wrapped) => Self::from_wrapped(source, &wrapped),
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                let (key, wrapped) = Self::create(source)?;
                // Written beside and renamed over, so a crash never leaves half a key.
                let tmp = path.with_extension("tmp");
                write_secret_file(&tmp, &wrapped)?;
                fs::rename(&tmp, path)?;
                Ok(key)
            }
            Err(e) => Err(e.into()),
        }
    }

    /// A new key that is never stored, so what it encrypts is unreadable once it is dropped.
    pub fn ephemeral() -> Self {
        Self { key: Key::<XChaCha20Poly1305>::generate() }
    }

    /// The data key kept wrapped in the file at `path`, or None when there is no file. Never
    /// makes one, for a reader that must not create keys.
    pub fn load_file(source: &MasterKeySource, path: &Path) -> Result<Option<Self>> {
        match fs::read_to_string(path) {
            Ok(wrapped) => Self::from_wrapped(source, &wrapped).map(Some),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// The key's 32 bytes, for a cipher outside this crate, such as SQLCipher's raw key.
    pub fn raw_bytes(&self) -> [u8; 32] {
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(self.key.as_slice());
        bytes
    }

    pub fn encrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        encrypt_data(data, &self.key)
    }

    pub fn decrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        decrypt_data(data, &self.key)
    }
}

/// Never prints the key.
impl fmt::Debug for DataKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("DataKey(..)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Error;

    #[test]
    fn round_trips_through_its_wrapped_form() -> Result<()> {
        let source = MasterKeySource::memory();
        let (key, wrapped) = DataKey::create(&source)?;
        let sealed = key.encrypt(b"authorization: Bearer abc")?;
        assert_eq!(sealed.len(), b"authorization: Bearer abc".len() + DataKey::OVERHEAD);
        assert!(!sealed.windows(6).any(|w| w == b"Bearer"));

        let unwrapped = DataKey::from_wrapped(&source, &wrapped)?;
        assert_eq!(unwrapped.decrypt(&sealed)?, b"authorization: Bearer abc");
        assert_eq!(key.decrypt(&unwrapped.encrypt(b"")?)?, b"");
        assert_eq!(unwrapped.raw_bytes(), key.raw_bytes());
        Ok(())
    }

    #[test]
    fn unwrapping_needs_the_same_master_key() -> Result<()> {
        let (_, wrapped) = DataKey::create(&MasterKeySource::memory())?;

        // One that has never had a master key does not get one made.
        let empty = MasterKeySource::memory();
        assert!(matches!(DataKey::from_wrapped(&empty, &wrapped), Err(Error::MissingMasterKey)));
        assert!(empty.store().get()?.is_none());

        let other = MasterKeySource::memory();
        DataKey::create(&other)?;
        assert!(matches!(DataKey::from_wrapped(&other, &wrapped), Err(Error::IncorrectMasterKey)));

        let refusing = MasterKeySource::refusing("denied");
        assert!(DataKey::create(&refusing).is_err());
        assert!(DataKey::from_wrapped(&refusing, &wrapped).is_err());
        Ok(())
    }

    #[test]
    fn a_wrong_key_does_not_decrypt() -> Result<()> {
        let source = MasterKeySource::memory();
        let (a, _) = DataKey::create(&source)?;
        let (b, _) = DataKey::create(&source)?;
        let sealed = a.encrypt(b"secret")?;
        assert!(matches!(b.decrypt(&sealed), Err(Error::DecryptionError)));
        assert_eq!(format!("{a:?}"), "DataKey(..)");
        Ok(())
    }

    #[test]
    fn the_key_file_is_made_once_and_read_back() -> Result<()> {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.key");
        let source = MasterKeySource::memory();
        let made = DataKey::load_or_create_file(&source, &path)?;
        let stored = fs::read_to_string(&path)?;
        assert!(!stored.is_empty());
        assert!(!dir.path().join("data.tmp").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path)?.permissions().mode() & 0o777, 0o600);
        }

        let read = DataKey::load_or_create_file(&source, &path)?;
        assert_eq!(read.raw_bytes(), made.raw_bytes());
        let loaded = DataKey::load_file(&source, &path)?.unwrap();
        assert_eq!(loaded.raw_bytes(), made.raw_bytes());
        assert!(DataKey::load_file(&source, &dir.path().join("none.key"))?.is_none());
        assert!(!dir.path().join("none.key").exists());
        assert_ne!(DataKey::ephemeral().raw_bytes(), DataKey::ephemeral().raw_bytes());
        assert_eq!(fs::read_to_string(&path)?, stored, "not rewritten");

        // Another master key cannot read it, and does not replace it.
        let other = MasterKeySource::memory();
        assert!(matches!(
            DataKey::load_or_create_file(&other, &path),
            Err(Error::MissingMasterKey)
        ));
        assert!(DataKey::load_or_create_file(&MasterKeySource::refusing("denied"), &path).is_err());
        assert_eq!(fs::read_to_string(&path)?, stored);
        Ok(())
    }

    /// Everyone asking at once, the first time, gets the same key: one master key, one data key.
    #[test]
    fn concurrent_first_loads_agree() -> Result<()> {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.key");
        let source = MasterKeySource::memory();
        let barrier = std::sync::Barrier::new(8);
        let keys: Vec<[u8; 32]> = std::thread::scope(|s| {
            let handles: Vec<_> = (0..8)
                .map(|_| {
                    s.spawn(|| {
                        barrier.wait();
                        DataKey::load_or_create_file(&source, &path).unwrap().raw_bytes()
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        assert!(keys.windows(2).all(|w| w[0] == w[1]));
        assert_eq!(DataKey::load_or_create_file(&source, &path)?.raw_bytes(), keys[0]);
        Ok(())
    }
}
