use crate::error::Result;
use crate::master_key::MasterKey;
use crate::persisted_key::PersistedKey;
use crate::workspace_keys::WorkspaceKeys;
use log::debug;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::Mutex;

const KEY_USER: &str = "yaak-encryption-key";

#[derive(Debug, Clone)]
pub struct EncryptionManager {
    cached_master_secret: Arc<Mutex<Option<MasterKey>>>,
    cached_workspace_secrets: WorkspaceKeys,
}

impl EncryptionManager {
    pub fn new<R: Runtime>(app_handle: &AppHandle<R>) -> Self {
        let workspace_secrets_path = app_handle.path().app_data_dir().unwrap().join("secrets");
        Self {
            cached_master_secret: Arc::new(Default::default()),
            cached_workspace_secrets: WorkspaceKeys::new(&workspace_secrets_path),
        }
    }

    pub async fn encrypt(&self, workspace_id: &str, data: Vec<u8>) -> Result<Vec<u8>> {
        debug!("Getting secret for encryption");
        let workspace_secret = self.get_workspace_key(workspace_id).await?;
        debug!("Encrypting data with {workspace_secret}");
        workspace_secret.encrypt(data)
    }

    pub async fn decrypt(&self, workspace_id: &str, data: Vec<u8>) -> Result<Vec<u8>> {
        debug!("Getting secret for decryption");
        let workspace_secret = self.get_workspace_key(workspace_id).await?;
        debug!("Decrypting data with {workspace_secret}");
        workspace_secret.decrypt(data)
    }

    async fn get_workspace_key(&self, workspace_id: &str) -> Result<PersistedKey> {
        debug!("Getting wkey for {workspace_id}");
        let mkey = self.get_master_key().await?;
        if let Some(s) = self.cached_workspace_secrets.get(workspace_id, &mkey).await? {
            debug!("Got cached workspace secret {s}");
            return Ok(s);
        };

        debug!("Generating new workspace secret");
        self.cached_workspace_secrets.generate(workspace_id, &mkey).await
    }

    async fn get_master_key(&self) -> Result<MasterKey> {
        {
            let master_secret = self.cached_master_secret.lock().await;
            if let Some(k) = master_secret.as_ref() {
                debug!("Got cached master secret");
                return Ok(k.to_owned());
            }
        }

        let mkey = MasterKey::get_or_create(KEY_USER)?;
        let mut master_secret = self.cached_master_secret.lock().await;
        *master_secret = Some(mkey.clone());
        Ok(mkey)
    }
}
