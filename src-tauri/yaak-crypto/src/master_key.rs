use crate::encryption::{decrypt_data, encrypt_data};
use crate::error::Error::GenericError;
use crate::error::Result;
use chacha20poly1305::aead::{Key, KeyInit, OsRng};
use chacha20poly1305::XChaCha20Poly1305;
use keyring::{Entry, Error};
use log::info;

#[derive(Debug, Clone)]
pub(crate) struct MasterKey {
    key: Key<XChaCha20Poly1305>,
}

impl MasterKey {
    pub(crate) fn get_or_create(user: &str) -> Result<Self> {
        let entry = Entry::new("app.yaak.desktop.EncryptionKey", user)?;

        let key = match entry.get_password() {
            Ok(encoded) => {
                let key_bytes =
                    base85::decode(&encoded).map_err(|e| GenericError(e.to_string()))?;
                let key = Key::<XChaCha20Poly1305>::clone_from_slice(key_bytes.as_slice());
                key
            }
            Err(Error::NoEntry) => {
                info!("Creating new master key");
                let key = XChaCha20Poly1305::generate_key(OsRng);
                let encoded = base85::encode(key.as_slice());
                entry.set_password(&encoded)?;
                key
            }
            Err(e) => return Err(GenericError(e.to_string())),
        };

        Ok(Self { key })
    }

    pub(crate) fn encrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        encrypt_data(data, &self.key)
    }

    pub(crate) fn decrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        decrypt_data(data, &self.key)
    }

    #[cfg(test)]
    pub(crate) fn test_key() -> Self {
        let key: Key<XChaCha20Poly1305> = Key::<XChaCha20Poly1305>::clone_from_slice(
            "00000000000000000000000000000000".as_bytes(),
        );
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
