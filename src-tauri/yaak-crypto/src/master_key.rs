use crate::encryption::{decrypt_data, encrypt_data};
use crate::error::Error::GenericError;
use crate::error::Result;
use aes_gcm::aead::OsRng;
use aes_gcm::{Aes256Gcm, Key, KeyInit};
use keyring::{Entry, Error};
use log::info;

#[derive(Debug, Clone)]
pub(crate) struct MasterKey {
    key: Key<Aes256Gcm>,
}

const MASTER_KEY_ID: &str = "master";

impl MasterKey {
    pub(crate) fn get_or_create(user: &str) -> Result<Self> {
        let entry = Entry::new("app.yaak.desktop.EncryptionKey", user)?;

        let key = match entry.get_password() {
            Ok(encoded) => {
                let key_bytes =
                    base85::decode(&encoded).map_err(|e| GenericError(e.to_string()))?;
                let key: Key<Aes256Gcm> = Key::<Aes256Gcm>::clone_from_slice(key_bytes.as_slice());
                key
            }
            Err(Error::NoEntry) => {
                info!("Creating new master key");
                let key = Aes256Gcm::generate_key(OsRng);
                let encoded = base85::encode(key.as_slice());
                entry.set_password(&encoded)?;
                key
            }
            Err(e) => return Err(GenericError(e.to_string())),
        };

        Ok(Self { key })
    }

    pub(crate) fn encrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        encrypt_data(data, &self.key, MASTER_KEY_ID)
    }

    pub(crate) fn decrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        decrypt_data(data, &self.key, MASTER_KEY_ID)
    }

    #[cfg(test)]
    pub(crate) fn test_key() -> Self {
        let key: Key<Aes256Gcm> =
            Key::<Aes256Gcm>::clone_from_slice("00000000000000000000000000000000".as_bytes());
        Self { key }
    }
}

#[cfg(test)]
mod tests {
    use crate::error::Result;
    use crate::master_key::MasterKey;

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
}
