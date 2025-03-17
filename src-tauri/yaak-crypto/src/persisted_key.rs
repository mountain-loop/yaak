use crate::encryption::{decrypt_data, encrypt_data};
use crate::error::Error::GenericError;
use crate::error::Result;
use crate::master_key::MasterKey;
use aes_gcm::aead::consts::U12;
use aes_gcm::aead::OsRng;
use aes_gcm::aes::Aes256;
use aes_gcm::{Aes256Gcm, AesGcm, Key, KeyInit};
use log::debug;
use std::fmt::{Display, Formatter};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use tokio::fs;

/// A helper to wrap a SecretString for use with encryption/decryption
#[derive(Debug, Default, Clone)]
pub(crate) struct PersistedKey {
    key: Key<AesGcm<Aes256, U12>>,
    path: PathBuf,
}

impl Display for PersistedKey {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(&format!("PersistedKey({:?})", self.path.file_name()))
    }
}

impl PersistedKey {
    pub(crate) async fn create(path: &Path, mkey: &MasterKey) -> Result<Self> {
        let path = path.to_path_buf();
        fs::create_dir_all(path.parent().unwrap()).await?;

        let key = Aes256Gcm::generate_key(OsRng);
        let encrypted_key = mkey.encrypt(key.to_vec())?;
        let encoded_key = base85::encode(encrypted_key.as_slice());
        debug!("Wrote secret to path {:?} {}", path, encoded_key);
        fs::write(&path, encoded_key).await?;
        let v = Self { key, path };
        Ok(v)
    }

    pub(crate) async fn open(path: &Path, mkey: &MasterKey) -> Result<Option<Self>> {
        debug!("Reading secret from {:?}", path);
        let encoded_key = match fs::read_to_string(path).await {
            Ok(secret) => secret,
            Err(e) => {
                return match e.kind() {
                    ErrorKind::NotFound => Ok(None),
                    e => Err(GenericError(e.to_string())),
                }
            }
        };

        debug!("Found secret at path {:?} {}", path, encoded_key);

        let encrypted_key =
            base85::decode(&encoded_key).map_err(|e| GenericError(e.to_string()))?;

        debug!("Decrypting key");
        let key = mkey.decrypt(encrypted_key)?;
        debug!("Decrypted key");
        let key = Key::<Aes256Gcm>::clone_from_slice(key.as_slice());
        debug!("Key {key:?}");
        Ok(Some(Self {
            path: path.to_path_buf(),
            key,
        }))
    }

    pub(crate) fn encrypt(&self, data: Vec<u8>) -> Result<Vec<u8>> {
        encrypt_data(data, &self.key)
    }

    pub(crate) fn decrypt(&self, data: Vec<u8>) -> Result<Vec<u8>> {
        decrypt_data(data, &self.key)
    }
}

#[cfg(test)]
mod tests {
    use crate::error::Result;
    use crate::master_key::MasterKey;
    use crate::workspace_keys::WorkspaceKeys;
    use std::env::temp_dir;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};
    use env_logger;

    fn init_logger() {
        env_logger::builder()
            .is_test(true) // Ensures it works in tests
            .filter_level(log::LevelFilter::Debug)
            .try_init()
            .ok();
    }

    #[tokio::test]
    async fn test_persisted_key() -> Result<()> {
        init_logger();

        let dir_name = format!("{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis());
        let dir = temp_dir().join(dir_name);
        fs::create_dir_all(&dir)?;

        // Test out the master key
        let mkey = MasterKey::get_or_create("hello")?;
        let encrypted = mkey.encrypt("hello".as_bytes().to_vec())?;
        let decrypted = mkey.decrypt(encrypted)?;
        assert_eq!(decrypted, "hello".as_bytes().to_vec());

        // Test out the workspace key
        let keys = WorkspaceKeys::new(&dir);
        let key = keys.generate("wrk_1", &mkey).await?;
        let encrypted = key.encrypt("Some data".as_bytes().to_vec())?;
        let decrypted = key.decrypt(encrypted)?;
        assert_eq!(decrypted, "Some data".as_bytes().to_vec());

        keys.clear().await;
        let mkey = MasterKey::get_or_create("hello").unwrap();
        let key = keys.get("wrk_1", &mkey).await.unwrap().unwrap();
        let encrypted = key.encrypt("Some data".as_bytes().to_vec())?;
        let decrypted = key.decrypt(encrypted)?;
        assert_eq!(decrypted, "Some data".as_bytes().to_vec());

        Ok(())
    }
}
