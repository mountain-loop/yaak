use crate::error::Result;
use crate::master_key::MasterKey;
use crate::persisted_key::PersistedKey;
use log::debug;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone)]
pub(crate) struct WorkspaceKeys {
    base_dir: PathBuf,
    cache: Arc<Mutex<HashMap<String, PersistedKey>>>,
}

impl WorkspaceKeys {
    pub(crate) fn new(base_dir: &Path) -> Self {
        Self {
            base_dir: base_dir.to_path_buf(),
            cache: Default::default(),
        }
    }

    #[allow(dead_code)]
    pub(crate) async fn clear(&self) {
        self.cache.lock().await.clear();
    }

    pub(crate) async fn get(
        &self,
        workspace_id: &str,
        mkey: &MasterKey,
    ) -> Result<Option<PersistedKey>> {
        // First, try getting from cache
        {
            let cached_secrets = self.cache.lock().await;
            if let Some(key) = cached_secrets.get(workspace_id) {
                return Ok(Some(key.clone()));
            }
        };

        let path = self.key_path(workspace_id);
        let key = match PersistedKey::open(&path, mkey)? {
            None => return Ok(None),
            Some(s) => s,
        };

        let mut cache = self.cache.lock().await;
        cache.insert(workspace_id.to_string(), key.clone());
        debug!("Inserted workspace key into cache {workspace_id}");
        Ok(Some(key))
    }

    pub(crate) async fn generate(
        &self,
        workspace_id: &str,
        mkey: &MasterKey,
    ) -> Result<PersistedKey> {
        let path = self.key_path(workspace_id);
        debug!("Creating new secret");
        let key = PersistedKey::create(&mkey)?;
        let mut metadata = BTreeMap::new();
        metadata.insert("workspaceId".to_string(), workspace_id.to_string());
        key.save_to_disk(&path, Some(metadata))?;

        debug!("Inserting secret into cache");
        let mut cached_secrets = self.cache.lock().await;
        cached_secrets.insert(workspace_id.to_string(), key.clone());
        Ok(key)
    }

    fn key_path(&self, workspace_id: &str) -> PathBuf {
        // Hash workspace ID just for consistent naming
        let digest = md5::compute(workspace_id);
        let name = format!("{:x}", digest);
        self.base_dir.join(format!("{}.enc.json", name))
    }
}
