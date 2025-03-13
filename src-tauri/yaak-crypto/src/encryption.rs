use crate::error::Result;
use keyring::Entry;

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

#[cfg(test)]
mod test {
    use crate::encryption::{get_keyring_password, set_keyring_password};
    use crate::error::Result;

    #[test]
    fn test_encrypt() -> Result<()> {
        set_keyring_password("service", "user", "text")?;
        let decrypted = get_keyring_password("service", "user")?;
        assert_eq!(decrypted, "text");
        Ok(())
    }
}
