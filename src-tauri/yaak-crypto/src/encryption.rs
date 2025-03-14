use crate::error::Result;
use age::secrecy::SecretString;
use keyring::Entry;
use rand::distributions::Alphanumeric;
use rand::Rng;
use std::io::{Read, Write};
use std::iter;

pub(crate) fn set_keyring_password(service: &str, user: &str, text: &str) -> Result<()> {
    let entry = Entry::new(service, user)?;
    entry.set_password(text)?;
    Ok(())
}

pub(crate) fn get_keyring_password(service: &str, user: &str) -> Result<String> {
    let entry = Entry::new(service, user)?;
    let password = entry.get_password()?;
    Ok(password)
}

pub(crate) fn encrypt_data(data: Vec<u8>, passphrase: &str) -> Result<Vec<u8>> {
    let passphrase = SecretString::from(passphrase);
    let encryptor = age::Encryptor::with_user_passphrase(passphrase.clone());

    let mut encrypted = vec![];
    let mut writer = encryptor.wrap_output(&mut encrypted)?;
    writer.write_all(data.as_slice())?;
    writer.finish()?;

    Ok(encrypted)
}

pub(crate) fn decrypt_data(encrypted: Vec<u8>, passphrase: &str) -> Result<Vec<u8>> {
    let passphrase = SecretString::from(passphrase);
    let decryptor = age::Decryptor::new(encrypted.as_slice())?;

    let mut decrypted = vec![];
    let mut reader = decryptor.decrypt(iter::once(&age::scrypt::Identity::new(passphrase) as _))?;
    reader.read_to_end(&mut decrypted)?;

    Ok(decrypted)
}

pub(crate) fn generate_passphrase() -> String {
    rand::thread_rng().sample_iter(&Alphanumeric).take(32).map(char::from).collect()
}

#[cfg(test)]
mod test {
    use crate::encryption::{decrypt_data, encrypt_data};
    use crate::error::Result;

    #[test]
    fn test_encrypt_decrypt() -> Result<()> {
        let encrypted = encrypt_data("hello world".into(), "passphrase")?;
        assert_eq!(encrypted.len(), 193);
        let decrypted = decrypt_data(encrypted, "passphrase")?;
        assert_eq!(String::from_utf8(decrypted).unwrap(), "hello world");
        Ok(())
    }
}
