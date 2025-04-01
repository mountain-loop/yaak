use crate::error::Error::GenericError;
use crate::error::Result;
use crate::master_key::MasterKey;
use crate::workspace_key::WorkspaceKey;
use base64::prelude::BASE64_STANDARD;
use base64::Engine;
use log::{debug, info};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, Runtime, State};
use yaak_models::models::{EncryptedKey, WorkspaceMeta};
use yaak_models::query_manager::{QueryManager, QueryManagerExt};
use yaak_models::util::UpdateSource;

const KEY_USER: &str = "yaak-encryption-key";

pub trait EncryptionManagerExt<'a, R> {
    fn crypto(&'a self) -> State<'a, EncryptionManager>;
}

impl<'a, R: Runtime, M: Manager<R>> EncryptionManagerExt<'a, R> for M {
    fn crypto(&'a self) -> State<'a, EncryptionManager> {
        self.state::<EncryptionManager>()
    }
}

#[derive(Debug, Clone)]
pub struct EncryptionManager {
    cached_master_key: Arc<Mutex<Option<MasterKey>>>,
    cached_workspace_keys: Arc<Mutex<HashMap<String, WorkspaceKey>>>,
    query_manager: QueryManager,
}

impl EncryptionManager {
    pub fn new<R: Runtime>(app_handle: &AppHandle<R>) -> Self {
        Self {
            cached_master_key: Default::default(),
            cached_workspace_keys: Default::default(),
            query_manager: app_handle.db_manager().inner().clone(),
        }
    }

    pub fn encrypt(&self, workspace_id: &str, data: &[u8]) -> Result<Vec<u8>> {
        let workspace_secret = self.get_workspace_key(workspace_id)?;
        workspace_secret.encrypt(data)
    }

    pub fn decrypt(&self, workspace_id: &str, data: &[u8]) -> Result<Vec<u8>> {
        let workspace_secret = self.get_workspace_key(workspace_id)?;
        workspace_secret.decrypt(data)
    }

    pub fn reveal_workspace_key(&self, workspace_id: &str) -> Result<String> {
        let key = self.get_workspace_key(workspace_id)?;
        key.to_human()
    }

    fn get_workspace_key(&self, workspace_id: &str) -> Result<WorkspaceKey> {
        {
            let cache = self.cached_workspace_keys.lock().unwrap();
            if let Some(k) = cache.get(workspace_id) {
                debug!("Got cached workspace key for {workspace_id}");
                return Ok(k.clone());
            }
        };

        let db = self.query_manager.connect();
        let workspace_meta = db.get_or_create_workspace_meta(workspace_id)?;

        let key = match workspace_meta.encryption_key {
            Some(k) => {
                let mkey = self.get_master_key()?;
                let decoded_key = BASE64_STANDARD
                    .decode(k.encrypted_key)
                    .map_err(|e| GenericError(format!("Failed to decode workspace key {e:?}")))?;
                let raw_key = mkey.decrypt(decoded_key.as_slice())?;
                WorkspaceKey::from_raw_key(raw_key.as_slice())
            }
            None => {
                let workspace_key = WorkspaceKey::create()?;
                let encrypted_key = self.get_master_key()?.encrypt(workspace_key.raw_key())?;
                let encrypted_key = BASE64_STANDARD.encode(encrypted_key);
                let workspace_meta = WorkspaceMeta {
                    encryption_key: Some(EncryptedKey { encrypted_key }),
                    ..workspace_meta
                };
                db.upsert_workspace_meta(&workspace_meta, &UpdateSource::Background)?;
                info!("Created workspace key for {workspace_id}");
                workspace_key
            }
        };

        let mut cache = self.cached_workspace_keys.lock().unwrap();
        cache.insert(workspace_id.to_string(), key.clone());

        Ok(key)
    }

    fn get_master_key(&self) -> Result<MasterKey> {
        {
            let master_secret = self.cached_master_key.lock().unwrap();
            if let Some(k) = master_secret.as_ref() {
                return Ok(k.to_owned());
            }
        }

        let mkey = MasterKey::get_or_create(KEY_USER)?;
        let mut master_secret = self.cached_master_key.lock().unwrap();
        *master_secret = Some(mkey.clone());
        Ok(mkey)
    }
}
