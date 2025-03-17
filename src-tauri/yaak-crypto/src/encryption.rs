use crate::error::Result;
use aes_gcm::aead::consts::U12;
use aes_gcm::aead::{Aead, OsRng};
use aes_gcm::aes::Aes256;
use aes_gcm::{AeadCore, Aes256Gcm, AesGcm, Key, KeyInit};

pub(crate) fn encrypt_data(data: Vec<u8>, key: &Key<Aes256Gcm>) -> Result<Vec<u8>> {
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let cipher = Aes256Gcm::new(&key);
    let ciphered_data = cipher.encrypt(&nonce, data.as_slice())?;

    // Byte:     |    0    | 1-13  | <-      ...     -> |
    // Contents: | version | Nonce | ... ciphertext ... |
    let mut data: Vec<u8> = vec![1];
    data.extend_from_slice(&nonce.as_slice());
    data.extend_from_slice(&ciphered_data);

    Ok(data)
}

pub(crate) fn decrypt_data(
    cipher_data: Vec<u8>,
    key: &Key<AesGcm<Aes256, U12>>,
) -> Result<Vec<u8>> {
    // Byte:     |    0    | 1-13  | <-      ...     -> |
    // Contents: | version | Nonce | ... ciphertext ... |
    let (version, rest) = cipher_data.split_at(1);
    let version = version[0];
    if version != 1 {
        panic!("Cypher text is the wrong version {}", version);
    }

    let (nonce, ciphered_data) = rest.split_at(12);

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

    #[test]
    fn test_encrypt_decrypt() -> Result<()> {
        let key = Aes256Gcm::generate_key(OsRng);
        let encrypted = encrypt_data("hello world".into(), &key)?;
        let decrypted = decrypt_data(encrypted, &key)?;
        assert_eq!(String::from_utf8(decrypted).unwrap(), "hello world");
        Ok(())
    }
}
