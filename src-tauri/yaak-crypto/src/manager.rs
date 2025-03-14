use crate::encryption::{
    decrypt_data, encrypt_data, generate_passphrase, get_keyring_password, set_keyring_password,
};
use crate::error::Error::GenericError;
use crate::error::{Error, Result};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Runtime};
use tokio::sync::Mutex;
use yaak_models::models::WorkspaceMeta;
use yaak_models::queries::{get_workspace, get_workspace_meta};

const KEY_SERVICE: &str = "app.yaak.desktop.EncryptionKey";
const KEY_USER: &str = "yaak-encryption-key";

#[derive(Debug, Clone)]
pub struct EncryptionManager<R: Runtime> {
    app_handle: AppHandle<R>,
    cached_master_key: Arc<Mutex<Option<String>>>,
    cached_workspace_keys: Arc<Mutex<HashMap<String, String>>>,
}

impl<R: Runtime> EncryptionManager<R> {
    pub fn new(app_handle: &AppHandle<R>) -> Self {
        Self {
            app_handle: app_handle.clone(),
            cached_master_key: Arc::new(Default::default()),
            cached_workspace_keys: Arc::new(Default::default()),
        }
    }

    pub async fn encrypt(&self, workspace_id: &str, data: Vec<u8>) -> Result<Vec<u8>> {
        let wkey = self.get_wkey(workspace_id).await?;
        encrypt_data(data, &wkey)
    }

    pub async fn decrypt(&self, workspace_id: &str, data: Vec<u8>) -> Result<Vec<u8>> {
        let wkey = self.get_wkey(workspace_id).await?;
        decrypt_data(data, &wkey)
    }

    async fn get_wkey(&self, workspace_id: &str) -> Result<String> {
        {
            let keys = self.cached_workspace_keys.lock().await;
            if let Some(k) = keys.get(workspace_id) {
                return Ok(k.clone());
            }
        }

        let workspace = get_workspace(&self.app_handle, workspace_id).await?;
        let workspace_meta = get_workspace_meta(&self.app_handle, &workspace).await?;
        let encrypted_wkey = match workspace_meta {
            Some(WorkspaceMeta {
                encrypted_key: Some(k),
                ..
            }) => k,
            _ => {
                return Err(Error::MissingWorkspaceKey(workspace_id.to_string()));
            }
        };

        let mkey = self.get_mkey().await?;
        let wkey = decrypt_data(encrypted_wkey, &mkey)?;
        let wkey = String::from_utf8(wkey).map_err(|e| GenericError(e.to_string()))?;

        let mut keys = self.cached_workspace_keys.lock().await;
        keys.insert(workspace_id.to_string(), wkey.clone());

        Ok(wkey)
    }

    async fn get_mkey(&self) -> Result<String> {
        {
            let mkey = self.cached_master_key.lock().await;
            if let Some(k) = mkey.as_ref() {
                return Ok(k.to_owned());
            }
        }

        let r = match get_keyring_password(KEY_SERVICE, KEY_USER) {
            Ok(r) => r,
            Err(e) => {
                if let Error::KeyringError(keyring::error::Error::NoEntry) = e {
                    let master_key = generate_passphrase();
                    set_keyring_password(KEY_SERVICE, KEY_USER, &master_key)?;
                    master_key
                } else {
                    return Err(e);
                }
            }
        };

        let mut mkey = self.cached_master_key.lock().await;
        *mkey = Some(r.clone());

        Ok(r)
    }
}
