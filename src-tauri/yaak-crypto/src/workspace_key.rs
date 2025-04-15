use crate::encryption::{decrypt_data, encrypt_data};
use crate::error::Error::InvalidHumanKey;
use crate::error::Result;
use base32::Alphabet;
use chacha20poly1305::aead::{Key, KeyInit, OsRng};
use chacha20poly1305::{KeySizeUser, XChaCha20Poly1305};

#[derive(Debug, Clone)]
pub struct WorkspaceKey {
    key: Key<XChaCha20Poly1305>,
}

const HUMAN_PREFIX: &str = "YK";

impl WorkspaceKey {
    pub(crate) fn to_human(&self) -> Result<String> {
        let encoded = base32::encode(Alphabet::Crockford {}, self.key.as_slice());
        let with_prefix = format!("{HUMAN_PREFIX}{encoded}");
        let with_separators = with_prefix
            .chars()
            .collect::<Vec<_>>()
            .chunks(6)
            .map(|chunk| chunk.iter().collect::<String>())
            .collect::<Vec<_>>()
            .join("-");
        Ok(with_separators)
    }

    #[allow(dead_code)]
    pub(crate) fn from_human(human_key: &str) -> Result<Self> {
        let without_prefix = human_key.strip_prefix(HUMAN_PREFIX).unwrap_or(human_key);
        let without_separators = without_prefix.replace("-", "");
        let key =
            base32::decode(Alphabet::Crockford {}, &without_separators).ok_or(InvalidHumanKey)?;
        if key.len() != XChaCha20Poly1305::key_size() {
            return Err(InvalidHumanKey);
        }
        Ok(Self::from_raw_key(key.as_slice()))
    }

    pub(crate) fn from_raw_key(key: &[u8]) -> Self {
        Self {
            key: Key::<XChaCha20Poly1305>::clone_from_slice(key),
        }
    }

    pub(crate) fn raw_key(&self) -> &[u8] {
        self.key.as_slice()
    }

    pub(crate) fn create() -> Result<Self> {
        let key = XChaCha20Poly1305::generate_key(OsRng);
        Ok(Self::from_raw_key(key.as_slice()))
    }

    pub(crate) fn encrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        encrypt_data(data, &self.key)
    }

    pub(crate) fn decrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        decrypt_data(data, &self.key)
    }

    #[cfg(test)]
    pub(crate) fn test_key() -> Self {
        Self::from_raw_key("f1a2d4b3c8e799af1456be3478a4c3f2".as_bytes())
    }
}

#[cfg(test)]
mod tests {
    use crate::error::Error::InvalidHumanKey;
    use crate::error::Result;
    use crate::workspace_key::WorkspaceKey;

    #[test]
    fn test_persisted_key() -> Result<()> {
        let key = WorkspaceKey::test_key();
        let encrypted = key.encrypt("hello".as_bytes())?;
        assert_eq!(key.decrypt(encrypted.as_slice())?, "hello".as_bytes());

        Ok(())
    }

    #[test]
    fn test_human_format() -> Result<()> {
        let key = WorkspaceKey::test_key();

        let encrypted = key.encrypt("hello".as_bytes())?;
        assert_eq!(key.decrypt(encrypted.as_slice())?, "hello".as_bytes());

        let human = key.to_human()?;
        assert_eq!(human, "YKCRRP-2CK46H-H36RSR-CMVKJE-B1CRRK-8D9PC9-JK6D1Q-71GK8R-SKCRS0");
        assert_eq!(
            WorkspaceKey::from_human(&human)?.decrypt(encrypted.as_slice())?,
            "hello".as_bytes()
        );

        Ok(())
    }

    #[test]
    fn test_from_human_invalid() -> Result<()> {
        assert!(matches!(
            WorkspaceKey::from_human(
                "YKCRRP-2CK46H-H36RSR-CMVKJE-B1CRRK-8D9PC9-JK6D1Q-71GK8R-SKCRS0-H3X38D",
            ),
            Err(InvalidHumanKey)
        ));

        assert!(matches!(WorkspaceKey::from_human("bad-key",), Err(InvalidHumanKey)));
        assert!(matches!(WorkspaceKey::from_human("",), Err(InvalidHumanKey)));

        Ok(())
    }
}
