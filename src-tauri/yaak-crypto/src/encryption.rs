use std::io::{Read, Write};
use crate::error::Result;
use age::secrecy::SecretString;
use keyring::Entry;
use std::iter;

pub fn set_keyring_password(service: &str, user: &str, text: &str) -> Result<()> {
    let entry = Entry::new(service, user)?;
    entry.set_password(text)?;
    Ok(())
}

pub fn get_keyring_password(service: &str, user: &str) -> Result<String> {
    let entry = Entry::new(service, user)?;
    let password = entry.get_password()?;
    Ok(password)
}

pub fn encrypt_text(plaintext: &str, passphrase: &str) -> Result<Vec<u8>> {
    let passphrase = SecretString::from(passphrase);
    let encryptor = age::Encryptor::with_user_passphrase(passphrase.clone());

    let mut encrypted = vec![];
    let mut writer = encryptor.wrap_output(&mut encrypted)?;
    writer.write_all(plaintext.as_bytes())?;
    writer.finish()?;

    Ok(encrypted)
}

pub fn decrypt_text(encrypted: &str, passphrase: &str) -> Result<Vec<u8>> {
    let passphrase = SecretString::from(passphrase);
    let decryptor = age::Decryptor::new(encrypted.as_bytes())?;

    let mut decrypted = vec![];
    let mut reader = decryptor.decrypt(iter::once(&age::scrypt::Identity::new(passphrase) as _))?;
    reader.read_to_end(&mut decrypted)?;

    Ok(decrypted)
}

// #[cfg(test)]
// mod test {
//     use crate::encryption::{get_keyring_password, set_keyring_password};
//     use crate::error::Result;
//
//     #[test]
//     fn test_encrypt() -> Result<()> {
//         set_keyring_password("service", "user", "text")?;
//         let decrypted = get_keyring_password("service", "user")?;
//         assert_eq!(decrypted, "text");
//         Ok(())
//     }
// }
