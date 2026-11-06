use crate::error::Error::{DecryptionError, EncryptionError, InvalidEncryptedData};
use crate::error::Result;
use chacha20poly1305::aead::array::typenum::Unsigned;
use chacha20poly1305::aead::{Aead, AeadCore, Generate, Key, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};

const ENCRYPTION_TAG: &str = "yA4k3nC";
const ENCRYPTION_VERSION: u8 = 1;

pub(crate) fn encrypt_data(data: &[u8], key: &Key<XChaCha20Poly1305>) -> Result<Vec<u8>> {
    let nonce = XNonce::generate();
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

    let nonce_bytes = <XChaCha20Poly1305 as AeadCore>::NonceSize::USIZE;
    let (nonce, ciphered_data) = rest.split_at_checked(nonce_bytes).ok_or(InvalidEncryptedData)?;

    let nonce: &XNonce = nonce.try_into().map_err(|_| InvalidEncryptedData)?;
    let cipher = XChaCha20Poly1305::new(&key);
    cipher.decrypt(nonce, ciphered_data).map_err(|_e| DecryptionError)
}

#[cfg(test)]
mod test {
    use crate::encryption::{decrypt_data, encrypt_data};
    use crate::error::Error::InvalidEncryptedData;
    use crate::error::Result;
    use chacha20poly1305::aead::{Generate, Key};
    use chacha20poly1305::XChaCha20Poly1305;

    #[test]
    fn test_encrypt_decrypt() -> Result<()> {
        let key = Key::<XChaCha20Poly1305>::generate();
        let encrypted = encrypt_data("hello world".as_bytes(), &key)?;
        let decrypted = decrypt_data(encrypted.as_slice(), &key)?;
        assert_eq!(String::from_utf8(decrypted).unwrap(), "hello world");
        Ok(())
    }

    #[test]
    fn test_decrypt_empty() -> Result<()> {
        let key = Key::<XChaCha20Poly1305>::generate();
        let encrypted = encrypt_data(&[], &key)?;
        assert_eq!(encrypted.len(), 48);
        let decrypted = decrypt_data(encrypted.as_slice(), &key)?;
        assert_eq!(String::from_utf8(decrypted).unwrap(), "");
        Ok(())
    }

    #[test]
    fn test_decrypt_bad_version() -> Result<()> {
        let key = Key::<XChaCha20Poly1305>::generate();
        let mut encrypted = encrypt_data("hello world".as_bytes(), &key)?;
        encrypted[7] = 0;
        let decrypted = decrypt_data(encrypted.as_slice(), &key);
        assert!(matches!(decrypted, Err(InvalidEncryptedData)));
        Ok(())
    }

    #[test]
    fn test_decrypt_bad_tag() -> Result<()> {
        let key = Key::<XChaCha20Poly1305>::generate();
        let mut encrypted = encrypt_data("hello world".as_bytes(), &key)?;
        encrypted[0] = 2;
        let decrypted = decrypt_data(encrypted.as_slice(), &key);
        assert!(matches!(decrypted, Err(InvalidEncryptedData)));
        Ok(())
    }

    #[test]
    fn test_decrypt_unencrypted_data() -> Result<()> {
        let key = Key::<XChaCha20Poly1305>::generate();
        let decrypted = decrypt_data("123".as_bytes(), &key);
        assert!(matches!(decrypted, Err(InvalidEncryptedData)));
        Ok(())
    }
}

#[cfg(test)]
mod compatibility {
    use super::*;

    /// Produced by chacha20poly1305 0.10.1. Decrypting it here proves a crate
    /// upgrade hasn't changed the on-disk format, which users already have
    /// rows of in their databases.
    const V1_FROM_0_10: &str = "7941346b336e43017c7cb13467eecaa963b11734be636f9cc4152de348584fb27e95d1a70973e557cd335cf29e12d0d305d63ca0aa168f1b17003b1690a9d49140f0";

    #[test]
    fn decrypts_data_written_by_the_previous_release() {
        let bytes: Vec<u8> = (0..V1_FROM_0_10.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&V1_FROM_0_10[i..i + 2], 16).unwrap())
            .collect();
        let key = Key::<XChaCha20Poly1305>::from([7u8; 32]);
        assert_eq!(decrypt_data(&bytes, &key).unwrap(), b"yaak golden vector");
    }
}
