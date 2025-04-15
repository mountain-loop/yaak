use crate::error::Error::{DecryptionError, EncryptionError, InvalidEncryptedData};
use crate::error::Result;
use chacha20poly1305::aead::generic_array::typenum::Unsigned;
use chacha20poly1305::aead::{Aead, AeadCore, Key, KeyInit, OsRng};
use chacha20poly1305::XChaCha20Poly1305;

const ENCRYPTION_TAG: &str = "yA4k3nC";
const ENCRYPTION_VERSION: u8 = 1;

pub(crate) fn encrypt_data(data: &[u8], key: &Key<XChaCha20Poly1305>) -> Result<Vec<u8>> {
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let cipher = XChaCha20Poly1305::new(&key);
    let ciphered_data = cipher.encrypt(&nonce, data).map_err(|_| EncryptionError)?;

    let mut data: Vec<u8> = Vec::new();
    data.extend_from_slice(ENCRYPTION_TAG.as_bytes()); // Tag
    data.push(ENCRYPTION_VERSION); // Version
    data.extend_from_slice(&nonce.as_slice()); // Nonce
    data.extend_from_slice(&ciphered_data); // Ciphertext

    Ok(data)
}

pub(crate) fn decrypt_data(cipher_data: &[u8], key: &Key<XChaCha20Poly1305>) -> Result<Vec<u8>> {
    // Yaak Tag + ID + Version + Nonce + ... ciphertext ...
    let (tag, rest) =
        cipher_data.split_at_checked(ENCRYPTION_TAG.len()).ok_or(InvalidEncryptedData)?;
    if tag != ENCRYPTION_TAG.as_bytes() {
        return Err(InvalidEncryptedData);
    }

    let (version, rest) = rest.split_at_checked(1).ok_or(InvalidEncryptedData)?;
    if version[0] != ENCRYPTION_VERSION {
        return Err(InvalidEncryptedData);
    }

    let nonce_bytes = <XChaCha20Poly1305 as AeadCore>::NonceSize::to_usize();
    let (nonce, ciphered_data) = rest.split_at_checked(nonce_bytes).ok_or(InvalidEncryptedData)?;

    let cipher = XChaCha20Poly1305::new(&key);
    cipher.decrypt(nonce.into(), ciphered_data).map_err(|_| DecryptionError)
}

#[cfg(test)]
mod test {
    use crate::encryption::{decrypt_data, encrypt_data};
    use crate::error::Error::InvalidEncryptedData;
    use crate::error::Result;
    use chacha20poly1305::aead::OsRng;
    use chacha20poly1305::{KeyInit, XChaCha20Poly1305};

    #[test]
    fn test_encrypt_decrypt() -> Result<()> {
        let key = XChaCha20Poly1305::generate_key(OsRng);
        let encrypted = encrypt_data("hello world".as_bytes(), &key)?;
        let decrypted = decrypt_data(encrypted.as_slice(), &key)?;
        assert_eq!(String::from_utf8(decrypted).unwrap(), "hello world");
        Ok(())
    }

    #[test]
    fn test_decrypt_empty() -> Result<()> {
        let key = XChaCha20Poly1305::generate_key(OsRng);
        let encrypted = encrypt_data(&[], &key)?;
        assert_eq!(encrypted.len(), 48);
        let decrypted = decrypt_data(encrypted.as_slice(), &key)?;
        assert_eq!(String::from_utf8(decrypted).unwrap(), "");
        Ok(())
    }

    #[test]
    fn test_decrypt_bad_version() -> Result<()> {
        let key = XChaCha20Poly1305::generate_key(OsRng);
        let mut encrypted = encrypt_data("hello world".as_bytes(), &key)?;
        encrypted[7] = 0;
        let decrypted = decrypt_data(encrypted.as_slice(), &key);
        assert!(matches!(decrypted, Err(InvalidEncryptedData)));
        Ok(())
    }

    #[test]
    fn test_decrypt_bad_tag() -> Result<()> {
        let key = XChaCha20Poly1305::generate_key(OsRng);
        let mut encrypted = encrypt_data("hello world".as_bytes(), &key)?;
        encrypted[0] = 2;
        let decrypted = decrypt_data(encrypted.as_slice(), &key);
        assert!(matches!(decrypted, Err(InvalidEncryptedData)));
        Ok(())
    }

    #[test]
    fn test_decrypt_unencrypted_data() -> Result<()> {
        let key = XChaCha20Poly1305::generate_key(OsRng);
        let decrypted = decrypt_data("123".as_bytes(), &key);
        assert!(matches!(decrypted, Err(InvalidEncryptedData)));
        Ok(())
    }
}
