use crate::error::Error::{InvalidEncryptedData, InvalidEncryptionVersion};
use crate::error::Result;
use aes_gcm::aead::consts::U12;
use aes_gcm::aead::{Aead, OsRng};
use aes_gcm::aes::Aes256;
use aes_gcm::{AeadCore, Aes256Gcm, AesGcm, Key, KeyInit};

const ENCRYPTION_TAG: &str = "yA4k3nC";
const ENCRYPTION_VERSION: u8 = 1;
const NONCE_LENGTH: usize = 12;

pub(crate) fn encrypt_data(data: &[u8], key: &Key<Aes256Gcm>) -> Result<Vec<u8>> {
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let cipher = Aes256Gcm::new(&key);
    let ciphered_data = cipher.encrypt(&nonce, data)?;

    // Yaak Tag + Version + Nonce + ... ciphertext ...
    let mut data: Vec<u8> = Vec::new();
    data.extend_from_slice(ENCRYPTION_TAG.as_bytes());
    data.push(ENCRYPTION_VERSION);
    data.extend_from_slice(&nonce.as_slice());
    data.extend_from_slice(&ciphered_data);

    Ok(data)
}

pub(crate) fn decrypt_data(
    cipher_data: &[u8],
    key: &Key<AesGcm<Aes256, U12>>,
) -> Result<Vec<u8>> {
    if cipher_data.len() < 36 {
        return Err(InvalidEncryptedData);
    }

    // Yaak Tag + Version + Nonce + ... ciphertext ...
    let (tag, rest) = cipher_data.split_at(ENCRYPTION_TAG.len());
    if tag != ENCRYPTION_TAG.as_bytes() {
        return Err(InvalidEncryptedData);
    }

    let (version, rest) = rest.split_at(1);
    let version = version[0];
    if version != ENCRYPTION_VERSION {
        return Err(InvalidEncryptionVersion(version));
    }

    let (nonce, ciphered_data) = rest.split_at(NONCE_LENGTH);

    let cipher = Aes256Gcm::new(&key);
    let data = cipher.decrypt(nonce.into(), ciphered_data)?;

    Ok(data)
}

#[cfg(test)]
mod test {
    use crate::encryption::{decrypt_data, encrypt_data};
    use crate::error::Result;
    use aes_gcm::aead::OsRng;
    use aes_gcm::{Aes256Gcm, KeyInit};
    use crate::error::Error::{InvalidEncryptedData, InvalidEncryptionVersion};

    #[test]
    fn test_encrypt_decrypt() -> Result<()> {
        let key = Aes256Gcm::generate_key(OsRng);
        let encrypted = encrypt_data("hello world".as_bytes(), &key)?;
        let decrypted = decrypt_data(encrypted.as_slice(), &key)?;
        assert_eq!(String::from_utf8(decrypted).unwrap(), "hello world");
        Ok(())
    }

    #[test]
    fn test_decrypt_empty() -> Result<()> {
        let key = Aes256Gcm::generate_key(OsRng);
        let encrypted = encrypt_data(&[], &key)?;
        assert_eq!(encrypted.len(), 36);
        let decrypted = decrypt_data(encrypted.as_slice(), &key)?;
        assert_eq!(String::from_utf8(decrypted).unwrap(), "");
        Ok(())
    }

    #[test]
    fn test_decrypt_bad_version() -> Result<()> {
        let key = Aes256Gcm::generate_key(OsRng);
        let mut encrypted = encrypt_data("hello world".as_bytes(), &key)?;
        encrypted[7] = 2;
        let decrypted = decrypt_data(encrypted.as_slice(), &key);
        assert!(matches!(decrypted, Err(InvalidEncryptionVersion(2))));
        Ok(())
    }

    #[test]
    fn test_decrypt_bad_tag() -> Result<()> {
        let key = Aes256Gcm::generate_key(OsRng);
        let mut encrypted = encrypt_data("hello world".as_bytes(), &key)?;
        encrypted[1] = 0;
        let decrypted = decrypt_data(encrypted.as_slice(), &key);
        assert!(matches!(decrypted, Err(InvalidEncryptedData)));
        Ok(())
    }

    #[test]
    fn test_decrypt_short_data() -> Result<()> {
        let key = Aes256Gcm::generate_key(OsRng);
        let decrypted = decrypt_data("123".as_bytes(), &key);
        assert!(matches!(decrypted, Err(InvalidEncryptedData)));
        Ok(())
    }
}
