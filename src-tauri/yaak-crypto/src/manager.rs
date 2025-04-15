use crate::error::Error::{GenericError, IncorrectWorkspaceKey, MissingWorkspaceKey};
use crate::error::{Error, Result};
use crate::master_key::MasterKey;
use crate::workspace_key::WorkspaceKey;
use base64::prelude::BASE64_STANDARD;
use base64::Engine;
use log::{info, warn};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, Runtime, State};
use yaak_models::models::{EncryptedKey, Workspace, WorkspaceMeta};
use yaak_models::query_manager::{QueryManager, QueryManagerExt};
use yaak_models::util::{generate_id_of_length, UpdateSource};

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

    pub fn set_human_key(&self, workspace_id: &str, human_key: &str) -> Result<WorkspaceMeta> {
        let wkey = WorkspaceKey::from_human(human_key)?;

        let workspace = self.query_manager.connect().get_workspace(workspace_id)?;
        let encryption_key_challenge = match workspace.encryption_key_challenge {
            None => return self.set_workspace_key(workspace_id, &wkey),
            Some(c) => c,
        };

        let encryption_key_challenge = match BASE64_STANDARD.decode(encryption_key_challenge) {
            Ok(c) => c,
            Err(_) => return Err(GenericError("Failed to decode workspace challenge".to_string())),
        };

        if let Err(_) = wkey.decrypt(encryption_key_challenge.as_slice()) {
            return Err(IncorrectWorkspaceKey);
        };

        self.set_workspace_key(workspace_id, &wkey)
    }

    pub(crate) fn set_workspace_key(
        &self,
        workspace_id: &str,
        wkey: &WorkspaceKey,
    ) -> Result<WorkspaceMeta> {
        info!("Created workspace key for {workspace_id}");

        let encrypted_key = BASE64_STANDARD.encode(self.get_master_key()?.encrypt(wkey.raw_key())?);
        let encrypted_key = EncryptedKey { encrypted_key };
        let encryption_key_challenge = wkey.encrypt(generate_id_of_length(50).as_bytes())?;
        let encryption_key_challenge = Some(BASE64_STANDARD.encode(encryption_key_challenge));

        let workspace_meta = self.query_manager.with_tx::<WorkspaceMeta, Error>(|tx| {
            let workspace = tx.get_workspace(workspace_id)?;
            let workspace_meta = tx.get_or_create_workspace_meta(workspace_id)?;
            tx.upsert_workspace(
                &Workspace {
                    encryption_key_challenge,
                    ..workspace
                },
                &UpdateSource::Background,
            )?;

            Ok(tx.upsert_workspace_meta(
                &WorkspaceMeta {
                    encryption_key: Some(encrypted_key.clone()),
                    ..workspace_meta
                },
                &UpdateSource::Background,
            )?)
        })?;

        let mut cache = self.cached_workspace_keys.lock().unwrap();
        cache.insert(workspace_id.to_string(), wkey.clone());

        Ok(workspace_meta)
    }

    pub(crate) fn ensure_workspace_key(&self, workspace_id: &str) -> Result<WorkspaceMeta> {
        let workspace_meta =
            self.query_manager.connect().get_or_create_workspace_meta(workspace_id)?;

        // Already exists
        if let Some(_) = workspace_meta.encryption_key {
            warn!("Tried to create workspace key when one already exists for {workspace_id}");
            return Ok(workspace_meta);
        }

        let wkey = WorkspaceKey::create()?;
        self.set_workspace_key(workspace_id, &wkey)
    }

    fn get_workspace_key(&self, workspace_id: &str) -> Result<WorkspaceKey> {
        {
            let cache = self.cached_workspace_keys.lock().unwrap();
            if let Some(k) = cache.get(workspace_id) {
                return Ok(k.clone());
            }
        };

        let db = self.query_manager.connect();
        let workspace_meta = db.get_or_create_workspace_meta(workspace_id)?;

        let key = match workspace_meta.encryption_key {
            None => return Err(MissingWorkspaceKey),
            Some(k) => k,
        };

        let mkey = self.get_master_key()?;
        let decoded_key = BASE64_STANDARD
            .decode(key.encrypted_key)
            .map_err(|e| GenericError(format!("Failed to decode workspace key {e:?}")))?;
        let raw_key = mkey.decrypt(decoded_key.as_slice())?;
        info!("Got existing workspace key for {workspace_id}");
        let wkey = WorkspaceKey::from_raw_key(raw_key.as_slice());

        Ok(wkey)
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
