use crate::encryption::{decrypt_data, encrypt_data};
use crate::error::Error::{GenericError, InvalidEncryptionKey};
use crate::error::Result;
use crate::master_key::MasterKey;
use aes_gcm::aead::consts::U12;
use aes_gcm::aead::OsRng;
use aes_gcm::aes::Aes256;
use aes_gcm::{Aes256Gcm, AesGcm, Key, KeyInit};
use base32::Alphabet;
use base64::prelude::BASE64_STANDARD;
use base64::Engine;
use log::debug;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedKey {
    #[serde(skip)]
    key: Key<AesGcm<Aes256, U12>>,
    enc_key: String,
    metadata: Option<BTreeMap<String, String>>,
}

const HUMAN_PREFIX: &str = "YK";

impl PersistedKey {
    pub(crate) fn to_human(&self) -> String {
        let encoded = base32::encode(Alphabet::Crockford {}, self.key.as_slice());
        let with_prefix = format!("{HUMAN_PREFIX}{encoded}");
        let with_separators = with_prefix
            .chars()
            .collect::<Vec<_>>()
            .chunks(6)
            .map(|chunk| chunk.iter().collect::<String>())
            .collect::<Vec<_>>()
            .join("-");
        with_separators
    }

    #[allow(dead_code)]
    pub(crate) fn from_human(human_key: &str, mkey: &MasterKey) -> Result<Self> {
        let without_prefix = human_key.strip_prefix(HUMAN_PREFIX).unwrap_or(human_key);
        let without_separators = without_prefix.replace("-", "");
        let key = base32::decode(Alphabet::Crockford {}, &without_separators)
            .ok_or(InvalidEncryptionKey)?;
        Self::from_raw_key(key.as_slice(), mkey)
    }

    pub(crate) fn create(mkey: &MasterKey) -> Result<Self> {
        let key = Aes256Gcm::generate_key(OsRng);
        let key = Self::from_raw_key(key.as_slice(), mkey)?;
        Ok(key)
    }

    #[cfg(test)]
    pub(crate) fn test_key(mkey: &MasterKey) -> Result<Self> {
        Self::from_raw_key("00000000000000000000000000000000".as_bytes(), mkey)
    }

    pub(crate) fn save_to_disk(
        &self,
        path: &Path,
        metadata: Option<BTreeMap<String, String>>,
    ) -> Result<()> {
        if self.enc_key.is_empty() {
            return Err(GenericError(
                "missing encrypted_key field when writing key file".to_string(),
            ));
        }

        let mut key = self.clone();
        key.metadata = metadata;

        let content = serde_json::to_vec_pretty(&key)?;
        fs::create_dir_all(path.parent().unwrap())?;
        fs::write(&path, content)?;
        debug!("Wrote encryption key to {:?}", path);
        Ok(())
    }

    pub(crate) fn from_raw_key(key: &[u8], mkey: &MasterKey) -> Result<Self> {
        let encrypted_key = mkey.encrypt(key)?;
        let encrypted_key = BASE64_STANDARD.encode(encrypted_key);

        let key = Key::<Aes256Gcm>::clone_from_slice(key);
        Ok(Self {
            key,
            enc_key: encrypted_key,
            metadata: None,
        })
    }

    pub(crate) fn open(path: &Path, mkey: &MasterKey) -> Result<Option<Self>> {
        debug!("Reading secret from {:?}", path);
        let contents = match fs::read(path) {
            Ok(secret) => secret,
            Err(e) => {
                return match e.kind() {
                    ErrorKind::NotFound => Ok(None),
                    e => Err(GenericError(e.to_string())),
                }
            }
        };

        let mut persisted_key: Self = serde_json::from_slice(contents.as_slice())?;

        let encrypted_key = BASE64_STANDARD
            .decode(persisted_key.enc_key.clone())
            .map_err(|e| GenericError(format!("Failed to decode key file {e:?}")))?;

        let key = mkey.decrypt(encrypted_key.as_slice())?;
        let key = Key::<Aes256Gcm>::clone_from_slice(key.as_slice());
        persisted_key.key = key;
        Ok(Some(persisted_key))
    }

    pub(crate) fn encrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        encrypt_data(data, &self.key)
    }

    pub(crate) fn decrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        decrypt_data(data, &self.key)
    }
}

#[cfg(test)]
mod tests {
    use crate::error::Result;
    use crate::master_key::MasterKey;
    use crate::persisted_key::PersistedKey;
    use std::collections::BTreeMap;
    use std::env::temp_dir;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn test_persisted_key() -> Result<()> {
        let key = PersistedKey::create(&MasterKey::test_key())?;
        let encrypted = key.encrypt("hello".as_bytes())?;
        assert_eq!(key.decrypt(encrypted.as_slice())?, "hello".as_bytes());

        Ok(())
    }

    #[test]
    fn test_read_write() -> Result<()> {
        let mkey = MasterKey::test_key();
        let dir_name =
            format!("{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis());
        let dir = temp_dir().join(dir_name);
        let path = dir.join("test.key");

        let key = PersistedKey::test_key(&mkey)?;
        let mut metadata = BTreeMap::new();
        metadata.insert("hello".to_string(), "world".to_string());
        key.save_to_disk(&path, Some(metadata))?;
        let encrypted = key.encrypt("hello".as_bytes())?;
        assert_eq!(key.decrypt(encrypted.as_slice())?, "hello".as_bytes());

        let key = PersistedKey::open(&path, &mkey)?.unwrap();
        assert_eq!(key.metadata.clone().unwrap().len(), 1);
        assert_eq!(
            key.metadata.clone().unwrap_or_default().get("hello").unwrap().to_string(),
            "world"
        );
        assert_eq!(key.decrypt(encrypted.as_slice())?, "hello".as_bytes());

        Ok(())
    }

    #[test]
    fn test_human_format() -> Result<()> {
        let mkey = MasterKey::test_key();
        let key = PersistedKey::test_key(&mkey)?;

        let encrypted = key.encrypt("hello".as_bytes())?;
        assert_eq!(key.decrypt(encrypted.as_slice())?, "hello".as_bytes());

        let human = key.to_human();
        assert_eq!(human, "YK60R3-0C1G60-R30C1G-60R30C-1G60R3-0C1G60-R30C1G-60R30C-1G60R0");
        assert_eq!(
            PersistedKey::from_human(&human, &mkey)?.decrypt(encrypted.as_slice())?,
            "hello".as_bytes()
        );

        Ok(())
    }
}
