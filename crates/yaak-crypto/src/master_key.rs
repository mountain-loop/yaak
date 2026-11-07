use crate::encryption::{decrypt_data, encrypt_data};
use crate::error::Error::GenericError;
use crate::error::Result;
use base32::Alphabet;
use chacha20poly1305::aead::{Generate, Key};
use chacha20poly1305::XChaCha20Poly1305;
use keyring::{Entry, Error};
use log::{info, warn};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const HUMAN_PREFIX: &str = "YKM_";

#[derive(Debug, Clone)]
pub(crate) struct MasterKey {
    key: Key<XChaCha20Poly1305>,
}

impl MasterKey {
    pub(crate) fn get_or_create(app_id: &str, user: &str) -> Result<Self> {
        Self::get_or_create_in(&KeychainStore::new(app_id, user))
    }

    /// The master key in `store`, or a new one put there when it has none. Callers in this
    /// process take turns, so two asking at once for the first time do not each make one, the
    /// second replacing the first and leaving what it wrapped unreadable.
    pub(crate) fn get_or_create_in(store: &dyn SecretStore) -> Result<Self> {
        static CREATING: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _turn = CREATING.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(key) = Self::get_in(store)? {
            return Ok(key);
        }
        info!("Creating new master key");
        let key = Key::<XChaCha20Poly1305>::generate();
        let encoded = base32::encode(Alphabet::Crockford {}, key.as_slice());
        store.set(&format!("{HUMAN_PREFIX}{encoded}"))?;
        Ok(Self { key })
    }

    /// The master key in `store`, or None when it has none.
    pub(crate) fn get_in(store: &dyn SecretStore) -> Result<Option<Self>> {
        let Some(encoded) = store.get()? else {
            return Ok(None);
        };
        let without_prefix = encoded.strip_prefix(HUMAN_PREFIX).unwrap_or(&encoded);
        let key_bytes = base32::decode(Alphabet::Crockford {}, without_prefix)
            .ok_or(GenericError("Failed to decode master key".to_string()))?;
        let key = Key::<XChaCha20Poly1305>::try_from(key_bytes.as_slice())
            .map_err(|_| GenericError("Master key is the wrong length".to_string()))?;
        Ok(Some(Self { key }))
    }

    pub(crate) fn encrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        encrypt_data(data, &self.key)
    }

    pub(crate) fn decrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        decrypt_data(data, &self.key)
    }

    #[cfg(test)]
    pub(crate) fn test_key() -> Self {
        let key = Key::<XChaCha20Poly1305>::from(*b"00000000000000000000000000000000");
        Self { key }
    }
}

/// Where a master key is kept, as the text [`MasterKey`] encodes it to.
pub(crate) trait SecretStore: Send + Sync {
    /// The secret, or None when none has been set.
    fn get(&self) -> Result<Option<String>>;
    fn set(&self, secret: &str) -> Result<()>;
}

/// Where an app's master key is kept: the OS credential store, normally. Cheap to clone.
#[derive(Clone)]
pub struct MasterKeySource {
    store: Arc<dyn SecretStore>,
}

impl MasterKeySource {
    /// The OS credential store, under `{app_id}.EncryptionKey`, where Yaak keeps its own: the
    /// macOS Keychain, the Windows Credential Manager or the Secret Service on Linux.
    pub fn keychain(app_id: &str) -> Self {
        Self { store: Arc::new(KeychainStore::new(app_id, KEYCHAIN_USER)) }
    }

    /// [`Self::keychain`], but on Linux without a Secret Service running, the key is kept in
    /// `path`, readable by the user alone, with a warning, rather than not at all.
    pub fn keychain_or_file(app_id: &str, path: impl Into<PathBuf>) -> Self {
        let store = KeychainStore::new(app_id, KEYCHAIN_USER).with_fallback_file(path.into());
        Self { store: Arc::new(store) }
    }

    /// A key held in memory for as long as this source and its clones live.
    #[cfg(any(test, feature = "test-support"))]
    pub fn memory() -> Self {
        Self { store: Arc::new(test_support::MemoryStore::default()) }
    }

    /// A store that refuses with `reason`, as a keychain does when access is denied.
    #[cfg(any(test, feature = "test-support"))]
    pub fn refusing(reason: impl Into<String>) -> Self {
        Self { store: Arc::new(test_support::RefusingStore(reason.into())) }
    }

    pub(crate) fn store(&self) -> &dyn SecretStore {
        self.store.as_ref()
    }
}

/// The account master keys are kept under, as [`crate::manager::EncryptionManager`] keeps
/// Yaak's.
const KEYCHAIN_USER: &str = "encryption-key";

/// The OS credential store, with a file to fall back to on Linux without a Secret Service.
struct KeychainStore {
    service: String,
    user: String,
    fallback_file: Option<PathBuf>,
}

impl KeychainStore {
    fn new(app_id: &str, user: &str) -> Self {
        Self { service: format!("{app_id}.EncryptionKey"), user: user.into(), fallback_file: None }
    }

    fn with_fallback_file(self, path: PathBuf) -> Self {
        Self { fallback_file: Some(path), ..self }
    }

    /// The fallback file, when `e` says there is no credential store to use and there is one.
    /// Denied access is not that: it stays an error.
    fn fallback_for(&self, e: &Error) -> Option<&Path> {
        let path = self.fallback_file.as_deref()?;
        is_missing_secret_service(e).then_some(path)
    }

    /// A key kept in the fallback file while there was no credential store. Read before
    /// creating one, so a Secret Service that turns up later does not replace it.
    fn fallback_secret(&self) -> Result<Option<String>> {
        match &self.fallback_file {
            Some(path) => read_secret_file(path),
            None => Ok(None),
        }
    }
}

impl SecretStore for KeychainStore {
    fn get(&self) -> Result<Option<String>> {
        let entry = Entry::new(&self.service, &self.user)?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(Error::NoEntry) => self.fallback_secret(),
            Err(e) => match self.fallback_for(&e) {
                Some(path) => read_secret_file(path),
                None => Err(GenericError(e.to_string())),
            },
        }
    }

    fn set(&self, secret: &str) -> Result<()> {
        let entry = Entry::new(&self.service, &self.user)?;
        match entry.set_password(secret) {
            Ok(()) => Ok(()),
            Err(e) => match self.fallback_for(&e) {
                Some(path) => {
                    warn!(
                        "No Secret Service is running ({e}), so the encryption key for {} is kept \
                        in {}, readable only by you, instead of the keyring",
                        self.service,
                        path.display()
                    );
                    write_secret_file(path, secret)
                }
                None => Err(e.into()),
            },
        }
    }
}

/// D-Bus errors that mean there is no session bus, or no Secret Service on it.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const MISSING_SERVICE_ERRORS: [&str; 7] = [
    "org.freedesktop.DBus.Error.ServiceUnknown",
    "org.freedesktop.DBus.Error.NameHasNoOwner",
    "org.freedesktop.DBus.Error.NoServer",
    "org.freedesktop.DBus.Error.FileNotFound",
    "org.freedesktop.DBus.Error.BadAddress",
    // Autolaunching a session bus without X11
    "org.freedesktop.DBus.Error.NotSupported",
    "org.freedesktop.DBus.Error.Spawn.ExecFailed",
];

/// `e` says there is no Secret Service to keep a key in: no session bus, or nothing on it
/// providing `org.freedesktop.secrets`. Every other failure, access denied, a locked
/// collection or a dismissed prompt among them, is not, so it stays an error rather than
/// putting the key in a file.
#[cfg(target_os = "linux")]
fn is_missing_secret_service(e: &Error) -> bool {
    let Error::PlatformFailure(inner) = e else {
        return false;
    };
    match inner.downcast_ref::<dbus_secret_service::Error>() {
        Some(dbus_secret_service::Error::Unavailable) => true,
        Some(dbus_secret_service::Error::Dbus(e)) => {
            e.name().is_some_and(|name| MISSING_SERVICE_ERRORS.contains(&name))
        }
        _ => false,
    }
}

/// Only Linux keeps keys in a service that may not be running.
#[cfg(not(target_os = "linux"))]
fn is_missing_secret_service(_e: &Error) -> bool {
    false
}

fn read_secret_file(path: &Path) -> Result<Option<String>> {
    match std::fs::read_to_string(path) {
        Ok(secret) => Ok(Some(secret.trim().to_string())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Writes `secret` to `path`, readable and writable by the user alone where the platform has
/// such modes.
pub(crate) fn write_secret_file(path: &Path, secret: &str) -> Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(path)?;
    // A file that already existed keeps its mode through `open`.
    #[cfg(unix)]
    file.set_permissions(std::os::unix::fs::PermissionsExt::from_mode(0o600))?;
    file.write_all(secret.as_bytes())?;
    file.sync_all()?;
    Ok(())
}

#[cfg(any(test, feature = "test-support"))]
mod test_support {
    use super::SecretStore;
    use crate::error::Error::GenericError;
    use crate::error::Result;
    use std::sync::Mutex;

    #[derive(Default)]
    pub(super) struct MemoryStore(Mutex<Option<String>>);

    impl SecretStore for MemoryStore {
        fn get(&self) -> Result<Option<String>> {
            Ok(self.0.lock().unwrap().clone())
        }

        fn set(&self, secret: &str) -> Result<()> {
            *self.0.lock().unwrap() = Some(secret.to_string());
            Ok(())
        }
    }

    pub(super) struct RefusingStore(pub(super) String);

    impl SecretStore for RefusingStore {
        fn get(&self) -> Result<Option<String>> {
            Err(GenericError(self.0.clone()))
        }

        fn set(&self, _secret: &str) -> Result<()> {
            Err(GenericError(self.0.clone()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Result;

    #[test]
    fn test_master_key() -> Result<()> {
        // Test out the master key
        let mkey = MasterKey::test_key();
        let encrypted = mkey.encrypt("hello".as_bytes())?;
        let decrypted = mkey.decrypt(encrypted.as_slice()).unwrap();
        assert_eq!(decrypted, "hello".as_bytes().to_vec());

        let mkey = MasterKey::test_key();
        let decrypted = mkey.decrypt(encrypted.as_slice()).unwrap();
        assert_eq!(decrypted, "hello".as_bytes().to_vec());

        Ok(())
    }

    #[test]
    fn creates_a_master_key_once() -> Result<()> {
        let source = MasterKeySource::memory();
        assert!(MasterKey::get_in(source.store())?.is_none());
        let created = MasterKey::get_or_create_in(source.store())?;
        let stored = source.store().get()?.unwrap();
        assert!(stored.starts_with(HUMAN_PREFIX), "{stored}");

        let again = MasterKey::get_or_create_in(source.store())?;
        assert_eq!(again.key, created.key);
        assert_eq!(source.store().get()?.unwrap(), stored);
        Ok(())
    }

    /// Several asking at once for the first time all get the one key that is stored.
    #[test]
    fn concurrent_first_creates_agree() {
        let source = MasterKeySource::memory();
        let barrier = std::sync::Barrier::new(8);
        let keys: Vec<_> = std::thread::scope(|s| {
            let handles: Vec<_> = (0..8)
                .map(|_| {
                    s.spawn(|| {
                        barrier.wait();
                        MasterKey::get_or_create_in(source.store()).unwrap().key
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        let stored = MasterKey::get_in(source.store()).unwrap().unwrap().key;
        assert!(keys.iter().all(|k| *k == stored));
    }

    #[test]
    fn a_refusing_store_gives_no_key() {
        let source = MasterKeySource::refusing("User canceled the operation");
        let err = MasterKey::get_or_create_in(source.store()).unwrap_err();
        assert_eq!(err.to_string(), "Encryption error: User canceled the operation");
    }

    #[test]
    fn the_fallback_file_is_private_and_read_back() -> Result<()> {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("keys").join("master.key");
        assert_eq!(read_secret_file(&path)?, None);

        write_secret_file(&path, "YKM_ABC")?;
        assert_eq!(read_secret_file(&path)?.as_deref(), Some("YKM_ABC"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path)?.permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }

        // Rewritten, it stays private and holds only the new key.
        write_secret_file(&path, "YKM_D")?;
        assert_eq!(read_secret_file(&path)?.as_deref(), Some("YKM_D"));
        Ok(())
    }

    #[test]
    fn falls_back_only_without_a_store() {
        let store = KeychainStore::new("app.yaak.test", "u").with_fallback_file("k".into());
        // Failures that do not say the Secret Service is missing, such as a denied D-Bus call,
        // which the backend also reports as a platform failure.
        let other = Error::PlatformFailure("org.freedesktop.DBus.Error.AccessDenied".into());
        let denied = Error::NoStorageAccess("prompt dismissed".into());
        assert!(store.fallback_for(&other).is_none());
        assert!(store.fallback_for(&denied).is_none());
        assert!(store.fallback_for(&Error::NoEntry).is_none());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn falls_back_on_linux_without_a_secret_service() {
        let store = KeychainStore::new("app.yaak.test", "u").with_fallback_file("k".into());
        let missing = Error::PlatformFailure(Box::new(dbus_secret_service::Error::Unavailable));
        assert!(store.fallback_for(&missing).is_some());
        assert!(KeychainStore::new("app.yaak.test", "u").fallback_for(&missing).is_none());
        let locked = Error::PlatformFailure(Box::new(dbus_secret_service::Error::Locked));
        assert!(store.fallback_for(&locked).is_none());
    }
}
