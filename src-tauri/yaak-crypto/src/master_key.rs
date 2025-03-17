use crate::encryption::{decrypt_data, encrypt_data};
use crate::error::Error::GenericError;
use crate::error::Result;
use aes_gcm::aead::OsRng;
use aes_gcm::{Aes256Gcm, Key, KeyInit};
use keyring::{Entry, Error};
use log::debug;

#[derive(Debug, Clone)]
pub(crate) struct MasterKey {
    key: Key<Aes256Gcm>,
}

impl MasterKey {
    pub(crate) fn get_or_create(user: &str) -> Result<Self> {
        let entry = Entry::new("app.yaak.desktop.EncryptionKey", user)?;

        let key = match entry.get_password() {
            Ok(encoded) => {
                debug!("Existing master secret {}", encoded);
                let key_bytes =
                    base85::decode(&encoded).map_err(|e| GenericError(e.to_string()))?;
                debug!("Decoded master secret {}", key_bytes.len());
                let key: Key<Aes256Gcm> = Key::<Aes256Gcm>::clone_from_slice(key_bytes.as_slice());
                key
            }
            Err(Error::NoEntry) => {
                let key = Aes256Gcm::generate_key(OsRng);
                let encoded = base85::encode(key.as_slice());
                entry.set_password(&encoded)?;
                key
            }
            Err(e) => return Err(GenericError(e.to_string())),
        };

        Ok(Self { key })
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
    use env_logger;
    use std::env::temp_dir;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn init_logger() {
        env_logger::builder()
            .is_test(true) // Ensures it works in tests
            .filter_level(log::LevelFilter::Debug)
            .try_init()
            .ok();
    }

    #[tokio::test]
    async fn test_master_key() -> Result<()> {
        init_logger();

        let dir_name =
            format!("{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis());
        let dir = temp_dir().join(dir_name);
        fs::create_dir_all(&dir)?;

        // Test out the master key
        let mkey = MasterKey::get_or_create("hello")?;
        let encrypted = mkey.encrypt("hello".as_bytes().to_vec())?;
        let decrypted = mkey.decrypt(encrypted.clone()).unwrap();
        assert_eq!(decrypted, "hello".as_bytes().to_vec());

        let mkey = MasterKey::get_or_create("hello")?;
        let decrypted = mkey.decrypt(encrypted).unwrap();
        assert_eq!(decrypted, "hello".as_bytes().to_vec());

        Ok(())
    }
}
