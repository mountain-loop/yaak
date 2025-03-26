use crate::error::Result;
use crate::master_key::MasterKey;
use crate::persisted_key::PersistedKey;
use crate::workspace_keys::WorkspaceKeys;
use log::info;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::Mutex;

const KEY_USER: &str = "yaak-encryption-key";

#[derive(Debug, Clone)]
pub struct EncryptionManager {
    cached_master_key: Arc<Mutex<Option<MasterKey>>>,
    workspace_keys: WorkspaceKeys,
}

impl EncryptionManager {
    pub fn new<R: Runtime>(app_handle: &AppHandle<R>) -> Self {
        let workspace_keys_path = app_handle.path().app_data_dir().unwrap().join("workspace-keys");
        Self {
            cached_master_key: Arc::new(Default::default()),
            workspace_keys: WorkspaceKeys::new(&workspace_keys_path),
        }
    }

    pub async fn encrypt(&self, workspace_id: &str, data: &[u8]) -> Result<Vec<u8>> {
        let workspace_secret = self.get_workspace_key(workspace_id).await?;
        workspace_secret.encrypt(data)
    }

    pub async fn decrypt(&self, workspace_id: &str, data: &[u8]) -> Result<Vec<u8>> {
        let workspace_secret = self.get_workspace_key(workspace_id).await?;
        workspace_secret.decrypt(data)
    }
    
    pub async fn reveal_workspace_key(&self, workspace_id: &str) -> Result<String> {
        let key = self.get_workspace_key(workspace_id).await?;
        Ok(key.to_human())
    }

    async fn get_workspace_key(&self, workspace_id: &str) -> Result<PersistedKey> {
        let mkey = self.get_master_key().await?;
        if let Some(s) = self.workspace_keys.get(workspace_id, &mkey).await? {
            return Ok(s);
        };

        info!("Generating new workspace secret");
        self.workspace_keys.generate(workspace_id, &mkey).await
    }

    async fn get_master_key(&self) -> Result<MasterKey> {
        {
            let master_secret = self.cached_master_key.lock().await;
            if let Some(k) = master_secret.as_ref() {
                return Ok(k.to_owned());
            }
        }

        let mkey = MasterKey::get_or_create(KEY_USER)?;
        let mut master_secret = self.cached_master_key.lock().await;
        *master_secret = Some(mkey.clone());
        Ok(mkey)
    }
}
