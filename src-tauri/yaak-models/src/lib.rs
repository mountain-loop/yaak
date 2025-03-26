use crate::commands::{delete, upsert};
use crate::query_manager::QueryManager;
use crate::util::ModelChangeEvent;
use log::info;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use sqlx::migrate::Migrator;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::SqlitePool;
use std::fs::create_dir_all;
use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;
use tauri::async_runtime::Mutex;
use tauri::path::BaseDirectory;
use tauri::plugin::TauriPlugin;
use tauri::{generate_handler, AppHandle, Emitter, Manager, Runtime};
use tokio::sync::mpsc;

mod commands;

mod connection_or_tx;
mod db_context;
pub mod error;
pub mod query_manager;
pub mod models;
pub mod queries;
pub mod util;
pub mod render;

pub struct SqliteConnection(pub Mutex<Pool<SqliteConnectionManager>>);

impl SqliteConnection {
    pub(crate) fn new(pool: Pool<SqliteConnectionManager>) -> Self {
        Self(Mutex::new(pool))
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("yaak_models")
        .invoke_handler(generate_handler![upsert, delete])
        .setup(|app_handle, _api| {
            let app_path = app_handle.path().app_data_dir().unwrap();
            create_dir_all(app_path.clone()).expect("Problem creating App directory!");

            let db_file_path = app_path.join("db.sqlite");

            {
                let db_file_path = db_file_path.clone();
                tauri::async_runtime::block_on(async move {
                    must_migrate_db(app_handle.app_handle(), &db_file_path).await;
                });
            };

            let manager = SqliteConnectionManager::file(db_file_path);
            let pool = Pool::builder()
                .max_size(100) // Up from 10 (just in case)
                .connection_timeout(Duration::from_secs(10)) // Down from 30
                .build(manager)
                .unwrap();

            app_handle.manage(SqliteConnection::new(pool.clone()));

            {
                let (tx, mut rx) = mpsc::channel(128);
                app_handle.manage(QueryManager::new(pool, tx));
                let app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    while let Some(p) = rx.recv().await {
                        let name = match p.change {
                            ModelChangeEvent::Upsert => "upserted_model",
                            ModelChangeEvent::Delete => "deleted_model",
                        };
                        app_handle.emit(name, p).unwrap();
                    }
                });
            }

            Ok(())
        })
        .build()
}

async fn must_migrate_db<R: Runtime>(app_handle: &AppHandle<R>, sqlite_file_path: &PathBuf) {
    info!("Connecting to database at {sqlite_file_path:?}");
    let sqlite_file_path = sqlite_file_path.to_str().unwrap().to_string();
    let opts = SqliteConnectOptions::from_str(&sqlite_file_path).unwrap().create_if_missing(true);
    let pool = SqlitePool::connect_with(opts).await.expect("Failed to connect to database");
    let p = app_handle
        .path()
        .resolve("migrations", BaseDirectory::Resource)
        .expect("failed to resolve resource");

    info!("Running database migrations from: {}", p.to_string_lossy());
    let mut m = Migrator::new(p).await.expect("Failed to load migrations");
    m.set_ignore_missing(true); // So we can roll back versions and not crash
    m.run(&pool).await.expect("Failed to run migrations");

    info!("Database migrations complete");
}
