use crate::encryption::{decrypt_data, encrypt_data};
use crate::error::Error::InvalidEncryptionKey;
use crate::error::Result;
use aes_gcm::aead::consts::U12;
use aes_gcm::aead::OsRng;
use aes_gcm::aes::Aes256;
use aes_gcm::{Aes256Gcm, AesGcm, Key, KeyInit};
use base32::Alphabet;

#[derive(Debug, Clone)]
pub struct WorkspaceKey {
    workspace_id: String,
    key: Key<AesGcm<Aes256, U12>>,
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
    pub(crate) fn from_human(workspace_id: &str, human_key: &str) -> Result<Self> {
        let without_prefix = human_key.strip_prefix(HUMAN_PREFIX).unwrap_or(human_key);
        let without_separators = without_prefix.replace("-", "");
        let key = base32::decode(Alphabet::Crockford {}, &without_separators)
            .ok_or(InvalidEncryptionKey)?;
        Ok(Self::from_raw_key(workspace_id, key.as_slice()))
    }

    pub(crate) fn from_raw_key(workspace_id: &str, key: &[u8]) -> Self {
        Self {
            workspace_id: workspace_id.to_string(),
            key: Key::<Aes256Gcm>::clone_from_slice(key),
        }
    }

    pub(crate) fn raw_key(&self) -> &[u8] {
        self.key.as_slice()
    }

    pub(crate) fn create(workspace_id: &str) -> Result<Self> {
        let key = Aes256Gcm::generate_key(OsRng);
        Ok(Self::from_raw_key(workspace_id, key.as_slice()))
    }

    pub(crate) fn encrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        encrypt_data(data, &self.key, &self.workspace_id)
    }

    pub(crate) fn decrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        decrypt_data(data, &self.key, &self.workspace_id)
    }

    #[cfg(test)]
    pub(crate) fn test_key(workspace_id: &str) -> Self {
        Self::from_raw_key(workspace_id, "00000000000000000000000000000000".as_bytes())
    }
}

#[cfg(test)]
mod tests {
    use crate::error::Result;
    use crate::workspace_key::WorkspaceKey;

    #[test]
    fn test_persisted_key() -> Result<()> {
        let key = WorkspaceKey::test_key("wrk");
        let encrypted = key.encrypt("hello".as_bytes())?;
        assert_eq!(key.decrypt(encrypted.as_slice())?, "hello".as_bytes());

        Ok(())
    }

    #[test]
    fn test_human_format() -> Result<()> {
        let key = WorkspaceKey::test_key("wrk_1");

        let encrypted = key.encrypt("hello".as_bytes())?;
        assert_eq!(key.decrypt(encrypted.as_slice())?, "hello".as_bytes());

        let human = key.to_human()?;
        assert_eq!(human, "YK60R3-0C1G60-R30C1G-60R30C-1G60R3-0C1G60-R30C1G-60R30C-1G60R0");
        assert_eq!(
            WorkspaceKey::from_human("wrk_1", &human)?.decrypt(encrypted.as_slice())?,
            "hello".as_bytes()
        );

        Ok(())
    }
}
