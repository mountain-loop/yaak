use crate::error::Error::{
    DecryptionError, EncryptionError, InvalidEncryptedData, IncorrectKeyId,
};
use crate::error::Result;
use chacha20poly1305::aead::generic_array::typenum::Unsigned;
use chacha20poly1305::aead::{Aead, AeadCore, Key, KeyInit, OsRng};
use chacha20poly1305::XChaCha20Poly1305;

const ENCRYPTION_TAG: &str = "yA4k3nC";
const ENCRYPTION_VERSION: u8 = 1;
const ID_BYTES: usize = 10;

pub(crate) fn encrypt_data(
    data: &[u8],
    key: &Key<XChaCha20Poly1305>,
    key_id: &str,
) -> Result<Vec<u8>> {
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let cipher = XChaCha20Poly1305::new(&key);
    let ciphered_data = cipher.encrypt(&nonce, data).map_err(|_| EncryptionError)?;

    let mut data: Vec<u8> = Vec::new();
    data.extend_from_slice(ENCRYPTION_TAG.as_bytes()); // Tag
    data.push(ENCRYPTION_VERSION); // Version
    data.extend_from_slice(&get_key_id_bytes(key_id)); // ID
    data.extend_from_slice(&nonce.as_slice()); // Nonce
    data.extend_from_slice(&ciphered_data); // Ciphertext

    Ok(data)
}

/// Decrypts data with a given key and key_id.
///
/// The key ID is just a helper to get better errors. If the ID doesn't match the ID in the cipher
/// but decryption succeeds, no error will be returned. However, if decryption fails and the key_id
/// didn't match, a key mismatch error can be returned instead of a generic decryption failed error.
pub(crate) fn decrypt_data(
    cipher_data: &[u8],
    key: &Key<XChaCha20Poly1305>,
    key_id: &str,
) -> Result<Vec<u8>> {
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

    let (existing_key_id, rest) = rest.split_at_checked(ID_BYTES).ok_or(InvalidEncryptedData)?;
    let key_id_check_passed = existing_key_id == get_key_id_bytes(key_id);

    let nonce_bytes = <XChaCha20Poly1305 as AeadCore>::NonceSize::to_usize();
    let (nonce, ciphered_data) = rest.split_at_checked(nonce_bytes).ok_or(InvalidEncryptedData)?;

    let cipher = XChaCha20Poly1305::new(&key);
    match cipher.decrypt(nonce.into(), ciphered_data).map_err(|_| DecryptionError) {
        Ok(d) => Ok(d),
        Err(_) if !key_id_check_passed => Err(IncorrectKeyId),
        Err(e) => Err(e),
    }
}

fn get_key_id_bytes(key_id: &str) -> [u8; ID_BYTES] {
    let key_id_hash = md5::compute(key_id);
    let mut result = [0u8; ID_BYTES];
    result.copy_from_slice(&key_id_hash[0..ID_BYTES]);
    result
}

#[cfg(test)]
mod test {
    use crate::encryption::{decrypt_data, encrypt_data};
    use crate::error::Error::{InvalidEncryptedData, IncorrectKeyId};
    use crate::error::Result;
    use chacha20poly1305::aead::OsRng;
    use chacha20poly1305::{KeyInit, XChaCha20Poly1305};
    use yaak_models::util::generate_id;

    #[test]
    fn test_encrypt_decrypt() -> Result<()> {
        let key = XChaCha20Poly1305::generate_key(OsRng);
        let key_id = generate_id();
        let encrypted = encrypt_data("hello world".as_bytes(), &key, &key_id)?;
        let decrypted = decrypt_data(encrypted.as_slice(), &key, &key_id)?;
        assert_eq!(String::from_utf8(decrypted).unwrap(), "hello world");
        Ok(())
    }

    #[test]
    fn test_decrypt_empty() -> Result<()> {
        let key = XChaCha20Poly1305::generate_key(OsRng);
        let key_id = generate_id();
        let encrypted = encrypt_data(&[], &key, &key_id)?;
        assert_eq!(encrypted.len(), 58);
        let decrypted = decrypt_data(encrypted.as_slice(), &key, &key_id)?;
        assert_eq!(String::from_utf8(decrypted).unwrap(), "");
        Ok(())
    }

    #[test]
    fn test_decrypt_bad_version() -> Result<()> {
        let key = XChaCha20Poly1305::generate_key(OsRng);
        let key_id = generate_id();
        let mut encrypted = encrypt_data("hello world".as_bytes(), &key, &key_id)?;
        encrypted[7] = 0;
        let decrypted = decrypt_data(encrypted.as_slice(), &key, &key_id);
        assert!(matches!(decrypted, Err(InvalidEncryptedData)));
        Ok(())
    }

    #[test]
    fn test_decrypt_bad_key_id_fail() -> Result<()> {
        let key_a = XChaCha20Poly1305::generate_key(OsRng);
        let key_b = XChaCha20Poly1305::generate_key(OsRng);
        let encrypted = encrypt_data("hello world".as_bytes(), &key_a, "key_1")?;
        let decrypted = decrypt_data(encrypted.as_slice(), &key_b, "key_2");
        assert!(matches!(decrypted, Err(IncorrectKeyId)));
        Ok(())
    }

    #[test]
    fn test_decrypt_bad_key_id_success() -> Result<()> {
        let key = XChaCha20Poly1305::generate_key(OsRng);
        let encrypted = encrypt_data("hello world".as_bytes(), &key, "key_1")?;
        let decrypted = decrypt_data(encrypted.as_slice(), &key, "key_2")?;
        assert_eq!(String::from_utf8(decrypted).unwrap(), "hello world");
        Ok(())
    }

    #[test]
    fn test_decrypt_bad_tag() -> Result<()> {
        let key = XChaCha20Poly1305::generate_key(OsRng);
        let key_id = generate_id();
        let mut encrypted = encrypt_data("hello world".as_bytes(), &key, &key_id)?;
        encrypted[0] = 2;
        let decrypted = decrypt_data(encrypted.as_slice(), &key, &key_id);
        assert!(matches!(decrypted, Err(InvalidEncryptedData)));
        Ok(())
    }

    #[test]
    fn test_decrypt_unencrypted_data() -> Result<()> {
        let key = XChaCha20Poly1305::generate_key(OsRng);
        let key_id = generate_id();
        let decrypted = decrypt_data("123".as_bytes(), &key, &key_id);
        assert!(matches!(decrypted, Err(InvalidEncryptedData)));
        Ok(())
    }
}
