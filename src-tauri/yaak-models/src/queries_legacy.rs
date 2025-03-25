use crate::error::Result;
use crate::manager::QueryManagerExt;
use crate::models::{
    AnyModel, CookieJar, CookieJarIden, Environment, EnvironmentIden, Folder, GrpcRequest,
    GrpcRequestIden, HttpRequest, HttpRequestIden, KeyValue, KeyValueIden, ModelType, Plugin,
    PluginIden, PluginKeyValue, PluginKeyValueIden, SyncState, SyncStateIden, WebsocketEvent,
    WebsocketEventIden, WebsocketRequest, Workspace, WorkspaceIden, WorkspaceMeta,
    WorkspaceMetaIden,
};
use crate::SqliteConnection;
use chrono::{NaiveDateTime, Utc};
use log::{debug, error, info, warn};
use nanoid::nanoid;
use rusqlite::OptionalExtension;
use sea_query::ColumnRef::Asterisk;
use sea_query::Keyword::CurrentTimestamp;
use sea_query::{Cond, Expr, OnConflict, Order, Query, SimpleExpr, SqliteQueryBuilder};
use sea_query_rusqlite::RusqliteBinder;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Emitter, Listener, Manager, Runtime, WebviewWindow};
use ts_rs::TS;

pub(crate) const MAX_HISTORY_ITEMS: usize = 20;

pub async fn set_key_value_string<R: Runtime>(
    app_handle: &AppHandle<R>,
    namespace: &str,
    key: &str,
    value: &str,
    update_source: &UpdateSource,
) -> (KeyValue, bool) {
    let encoded = serde_json::to_string(value);
    set_key_value_raw(app_handle, namespace, key, &encoded.unwrap(), update_source).await
}

pub async fn set_key_value_int<R: Runtime>(
    app_handle: &AppHandle<R>,
    namespace: &str,
    key: &str,
    value: i32,
    update_source: &UpdateSource,
) -> (KeyValue, bool) {
    let encoded = serde_json::to_string(&value);
    set_key_value_raw(app_handle, namespace, key, &encoded.unwrap(), update_source).await
}

pub async fn get_key_value_string<R: Runtime>(
    app_handle: &AppHandle<R>,
    namespace: &str,
    key: &str,
    default: &str,
) -> String {
    match get_key_value_raw(app_handle, namespace, key).await {
        None => default.to_string(),
        Some(v) => {
            let result = serde_json::from_str(&v.value);
            match result {
                Ok(v) => v,
                Err(e) => {
                    error!("Failed to parse string key value: {}", e);
                    default.to_string()
                }
            }
        }
    }
}

pub async fn get_key_value_int<R: Runtime>(
    app_handle: &AppHandle<R>,
    namespace: &str,
    key: &str,
    default: i32,
) -> i32 {
    match get_key_value_raw(app_handle, namespace, key).await {
        None => default.clone(),
        Some(v) => {
            let result = serde_json::from_str(&v.value);
            match result {
                Ok(v) => v,
                Err(e) => {
                    error!("Failed to parse int key value: {}", e);
                    default.clone()
                }
            }
        }
    }
}

pub async fn set_key_value_raw<R: Runtime>(
    app_handle: &AppHandle<R>,
    namespace: &str,
    key: &str,
    value: &str,
    update_source: &UpdateSource,
) -> (KeyValue, bool) {
    let existing = get_key_value_raw(app_handle, namespace, key).await;

    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::insert()
        .into_table(KeyValueIden::Table)
        .columns([
            KeyValueIden::CreatedAt,
            KeyValueIden::UpdatedAt,
            KeyValueIden::Namespace,
            KeyValueIden::Key,
            KeyValueIden::Value,
        ])
        .values_panic([
            CurrentTimestamp.into(),
            CurrentTimestamp.into(),
            namespace.into(),
            key.into(),
            value.into(),
        ])
        .on_conflict(
            OnConflict::new()
                .update_columns([KeyValueIden::UpdatedAt, KeyValueIden::Value])
                .to_owned(),
        )
        .returning_all()
        .build_rusqlite(SqliteQueryBuilder);

    let mut stmt = db.prepare(sql.as_str()).expect("Failed to prepare KeyValue upsert");
    let m: KeyValue = stmt
        .query_row(&*params.as_params(), |row| row.try_into())
        .expect("Failed to upsert KeyValue");
    emit_upserted_model(app_handle, &AnyModel::KeyValue(m.to_owned()), update_source);
    (m, existing.is_none())
}

pub async fn delete_key_value<R: Runtime>(
    app_handle: &AppHandle<R>,
    namespace: &str,
    key: &str,
    update_source: &UpdateSource,
) {
    let kv = match get_key_value_raw(app_handle, namespace, key).await {
        None => return,
        Some(m) => m,
    };

    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::delete()
        .from_table(KeyValueIden::Table)
        .cond_where(
            Cond::all()
                .add(Expr::col(KeyValueIden::Namespace).eq(namespace))
                .add(Expr::col(KeyValueIden::Key).eq(key)),
        )
        .build_rusqlite(SqliteQueryBuilder);
    db.execute(sql.as_str(), &*params.as_params()).expect("Failed to delete PluginKeyValue");
    emit_deleted_model(app_handle, &AnyModel::KeyValue(kv.to_owned()), update_source);
}

pub async fn list_key_values_raw<R: Runtime>(app_handle: &AppHandle<R>) -> Result<Vec<KeyValue>> {
    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(KeyValueIden::Table)
        .column(Asterisk)
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
    Ok(items.map(|v| v.unwrap()).collect())
}

pub async fn get_key_value_raw<R: Runtime>(
    app_handle: &AppHandle<R>,
    namespace: &str,
    key: &str,
) -> Option<KeyValue> {
    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(KeyValueIden::Table)
        .column(Asterisk)
        .cond_where(
            Cond::all()
                .add(Expr::col(KeyValueIden::Namespace).eq(namespace))
                .add(Expr::col(KeyValueIden::Key).eq(key)),
        )
        .build_rusqlite(SqliteQueryBuilder);

    db.query_row(sql.as_str(), &*params.as_params(), |row| row.try_into()).ok()
}

pub async fn get_plugin_key_value<R: Runtime>(
    app_handle: &AppHandle<R>,
    plugin_name: &str,
    key: &str,
) -> Option<PluginKeyValue> {
    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(PluginKeyValueIden::Table)
        .column(Asterisk)
        .cond_where(
            Cond::all()
                .add(Expr::col(PluginKeyValueIden::PluginName).eq(plugin_name))
                .add(Expr::col(PluginKeyValueIden::Key).eq(key)),
        )
        .build_rusqlite(SqliteQueryBuilder);

    db.query_row(sql.as_str(), &*params.as_params(), |row| row.try_into()).ok()
}

pub async fn set_plugin_key_value<R: Runtime>(
    app_handle: &AppHandle<R>,
    plugin_name: &str,
    key: &str,
    value: &str,
) -> (PluginKeyValue, bool) {
    let existing = get_plugin_key_value(app_handle, plugin_name, key).await;

    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::insert()
        .into_table(PluginKeyValueIden::Table)
        .columns([
            PluginKeyValueIden::CreatedAt,
            PluginKeyValueIden::UpdatedAt,
            PluginKeyValueIden::PluginName,
            PluginKeyValueIden::Key,
            PluginKeyValueIden::Value,
        ])
        .values_panic([
            CurrentTimestamp.into(),
            CurrentTimestamp.into(),
            plugin_name.into(),
            key.into(),
            value.into(),
        ])
        .on_conflict(
            OnConflict::new()
                .update_columns([PluginKeyValueIden::UpdatedAt, PluginKeyValueIden::Value])
                .to_owned(),
        )
        .returning_all()
        .build_rusqlite(SqliteQueryBuilder);

    let mut stmt = db.prepare(sql.as_str()).expect("Failed to prepare PluginKeyValue upsert");
    let m: PluginKeyValue = stmt
        .query_row(&*params.as_params(), |row| row.try_into())
        .expect("Failed to upsert KeyValue");
    (m, existing.is_none())
}

pub async fn delete_plugin_key_value<R: Runtime>(
    app_handle: &AppHandle<R>,
    plugin_name: &str,
    key: &str,
) -> bool {
    if let None = get_plugin_key_value(app_handle, plugin_name, key).await {
        return false;
    }

    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::delete()
        .from_table(PluginKeyValueIden::Table)
        .cond_where(
            Cond::all()
                .add(Expr::col(PluginKeyValueIden::PluginName).eq(plugin_name))
                .add(Expr::col(PluginKeyValueIden::Key).eq(key)),
        )
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str()).unwrap();
    stmt.execute(&*params.as_params()).expect("Failed to delete PluginKeyValue");
    true
}

pub async fn list_workspace_metas<R: Runtime>(
    app_handle: &AppHandle<R>,
) -> Result<Vec<WorkspaceMeta>> {
    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(WorkspaceMetaIden::Table)
        .column(Asterisk)
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
    Ok(items.map(|v| v.unwrap()).collect())
}

pub async fn get_workspace_meta<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace: &Workspace,
) -> Result<Option<WorkspaceMeta>> {
    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(WorkspaceMetaIden::Table)
        .column(Asterisk)
        .cond_where(Expr::col(WorkspaceMetaIden::WorkspaceId).eq(&workspace.id))
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    Ok(stmt.query_row(&*params.as_params(), |row| row.try_into()).optional()?)
}

pub async fn get_or_create_workspace_meta<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace: &Workspace,
    update_source: &UpdateSource,
) -> Result<WorkspaceMeta> {
    let workspace_meta = get_workspace_meta(app_handle, workspace).await?;
    if let Some(m) = workspace_meta {
        return Ok(m);
    }

    upsert_workspace_meta(
        app_handle,
        WorkspaceMeta {
            workspace_id: workspace.to_owned().id,
            ..Default::default()
        },
        update_source,
    )
    .await
}

pub async fn upsert_workspace_meta<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace_meta: WorkspaceMeta,
    update_source: &UpdateSource,
) -> Result<WorkspaceMeta> {
    let id = match workspace_meta.id.as_str() {
        "" => generate_model_id(ModelType::TypeWorkspaceMeta),
        _ => workspace_meta.id.to_string(),
    };

    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::insert()
        .into_table(WorkspaceMetaIden::Table)
        .columns([
            WorkspaceMetaIden::Id,
            WorkspaceMetaIden::WorkspaceId,
            WorkspaceMetaIden::CreatedAt,
            WorkspaceMetaIden::UpdatedAt,
            WorkspaceMetaIden::SettingSyncDir,
        ])
        .values_panic([
            id.as_str().into(),
            workspace_meta.workspace_id.into(),
            upsert_date(update_source, workspace_meta.created_at).into(),
            upsert_date(update_source, workspace_meta.updated_at).into(),
            workspace_meta.setting_sync_dir.into(),
        ])
        .on_conflict(
            OnConflict::column(GrpcRequestIden::Id)
                .update_columns([
                    WorkspaceMetaIden::UpdatedAt,
                    WorkspaceMetaIden::SettingSyncDir,
                ])
                .to_owned(),
        )
        .returning_all()
        .build_rusqlite(SqliteQueryBuilder);

    let mut stmt = db.prepare(&sql)?;
    let m: WorkspaceMeta = stmt.query_row(&*params.as_params(), |row| row.try_into())?;
    emit_upserted_model(app_handle, &AnyModel::WorkspaceMeta(m.to_owned()), update_source);
    Ok(m)
}

pub async fn get_cookie_jar<R: Runtime>(app_handle: &AppHandle<R>, id: &str) -> Result<CookieJar> {
    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::select()
        .from(CookieJarIden::Table)
        .column(Asterisk)
        .cond_where(Expr::col(CookieJarIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    Ok(stmt.query_row(&*params.as_params(), |row| row.try_into())?)
}

pub async fn list_cookie_jars<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace_id: &str,
) -> Result<Vec<CookieJar>> {
    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(CookieJarIden::Table)
        .column(Asterisk)
        .cond_where(Expr::col(CookieJarIden::WorkspaceId).eq(workspace_id))
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
    Ok(items.map(|v| v.unwrap()).collect())
}

pub async fn delete_cookie_jar<R: Runtime>(
    app_handle: &AppHandle<R>,
    id: &str,
    update_source: &UpdateSource,
) -> Result<CookieJar> {
    let cookie_jar = get_cookie_jar(app_handle, id).await?;
    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::delete()
        .from_table(CookieJarIden::Table)
        .cond_where(Expr::col(WorkspaceIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    db.execute(sql.as_str(), &*params.as_params())?;

    emit_deleted_model(app_handle, &AnyModel::CookieJar(cookie_jar.to_owned()), update_source);
    Ok(cookie_jar)
}

pub async fn upsert_websocket_event<R: Runtime>(
    app_handle: &AppHandle<R>,
    event: WebsocketEvent,
    update_source: &UpdateSource,
) -> Result<WebsocketEvent> {
    let id = match event.id.as_str() {
        "" => generate_model_id(ModelType::TypeWebSocketEvent),
        _ => event.id.to_string(),
    };

    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::insert()
        .into_table(WebsocketEventIden::Table)
        .columns([
            WebsocketEventIden::Id,
            WebsocketEventIden::CreatedAt,
            WebsocketEventIden::UpdatedAt,
            WebsocketEventIden::WorkspaceId,
            WebsocketEventIden::ConnectionId,
            WebsocketEventIden::RequestId,
            WebsocketEventIden::MessageType,
            WebsocketEventIden::IsServer,
            WebsocketEventIden::Message,
        ])
        .values_panic([
            id.into(),
            upsert_date(update_source, event.created_at).into(),
            upsert_date(update_source, event.updated_at).into(),
            event.workspace_id.into(),
            event.connection_id.into(),
            event.request_id.into(),
            serde_json::to_string(&event.message_type)?.into(),
            event.is_server.into(),
            event.message.into(),
        ])
        .on_conflict(
            OnConflict::column(WebsocketEventIden::Id)
                .update_columns([
                    WebsocketEventIden::UpdatedAt,
                    WebsocketEventIden::MessageType,
                    WebsocketEventIden::IsServer,
                    WebsocketEventIden::Message,
                ])
                .to_owned(),
        )
        .returning_all()
        .build_rusqlite(SqliteQueryBuilder);

    let mut stmt = db.prepare(sql.as_str())?;
    let m: WebsocketEvent = stmt.query_row(&*params.as_params(), |row| row.try_into())?;
    emit_upserted_model(app_handle, &AnyModel::WebsocketEvent(m.to_owned()), update_source);
    Ok(m)
}

pub async fn list_websocket_events<R: Runtime>(
    app_handle: &AppHandle<R>,
    connection_id: &str,
) -> Result<Vec<WebsocketEvent>> {
    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(WebsocketEventIden::Table)
        .cond_where(Expr::col(WebsocketEventIden::ConnectionId).eq(connection_id))
        .column(Asterisk)
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
    Ok(items.map(|v| v.unwrap()).collect())
}

pub async fn upsert_cookie_jar<R: Runtime>(
    app_handle: &AppHandle<R>,
    cookie_jar: &CookieJar,
    update_source: &UpdateSource,
) -> Result<CookieJar> {
    let id = match cookie_jar.id.as_str() {
        "" => generate_model_id(ModelType::TypeCookieJar),
        _ => cookie_jar.id.to_string(),
    };
    let trimmed_name = cookie_jar.name.trim();

    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::insert()
        .into_table(CookieJarIden::Table)
        .columns([
            CookieJarIden::Id,
            CookieJarIden::CreatedAt,
            CookieJarIden::UpdatedAt,
            CookieJarIden::WorkspaceId,
            CookieJarIden::Name,
            CookieJarIden::Cookies,
        ])
        .values_panic([
            id.as_str().into(),
            upsert_date(update_source, cookie_jar.created_at).into(),
            upsert_date(update_source, cookie_jar.updated_at).into(),
            cookie_jar.workspace_id.as_str().into(),
            trimmed_name.into(),
            serde_json::to_string(&cookie_jar.cookies)?.into(),
        ])
        .on_conflict(
            OnConflict::column(CookieJarIden::Id)
                .update_columns([
                    CookieJarIden::UpdatedAt,
                    CookieJarIden::Name,
                    CookieJarIden::Cookies,
                ])
                .to_owned(),
        )
        .returning_all()
        .build_rusqlite(SqliteQueryBuilder);

    let mut stmt = db.prepare(sql.as_str())?;
    let m: CookieJar = stmt.query_row(&*params.as_params(), |row| row.try_into())?;
    emit_upserted_model(app_handle, &AnyModel::CookieJar(m.to_owned()), update_source);
    Ok(m)
}

pub async fn ensure_base_environment<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace_id: &str,
) -> Result<()> {
    let environments = list_environments(app_handle, workspace_id).await?;
    let base_environment =
        environments.iter().find(|e| e.environment_id == None && e.workspace_id == workspace_id);

    if let None = base_environment {
        info!("Creating base environment for {workspace_id}");
        upsert_environment(
            app_handle,
            Environment {
                workspace_id: workspace_id.to_string(),
                name: "Global Variables".to_string(),
                ..Default::default()
            },
            &UpdateSource::Background,
        )
        .await?;
    }

    Ok(())
}

pub async fn list_environments<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace_id: &str,
) -> Result<Vec<Environment>> {
    let environments: Vec<Environment> = {
        let dbm = &*app_handle.state::<SqliteConnection>();
        let db = dbm.0.lock().await.get().unwrap();
        let (sql, params) = Query::select()
            .from(EnvironmentIden::Table)
            .cond_where(Expr::col(EnvironmentIden::WorkspaceId).eq(workspace_id))
            .column(Asterisk)
            .order_by(EnvironmentIden::Name, Order::Asc)
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = db.prepare(sql.as_str())?;
        let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
        items.map(|v| v.unwrap()).collect()
    };

    Ok(environments)
}

pub async fn delete_environment<R: Runtime>(
    app_handle: &AppHandle<R>,
    id: &str,
    update_source: &UpdateSource,
) -> Result<Environment> {
    let env = get_environment(app_handle, id).await?;

    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::delete()
        .from_table(EnvironmentIden::Table)
        .cond_where(Expr::col(EnvironmentIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);

    db.execute(sql.as_str(), &*params.as_params())?;

    emit_deleted_model(app_handle, &AnyModel::Environment(env.to_owned()), update_source);
    Ok(env)
}

pub async fn upsert_environment<R: Runtime>(
    app_handle: &AppHandle<R>,
    environment: Environment,
    update_source: &UpdateSource,
) -> Result<Environment> {
    let id = match environment.id.as_str() {
        "" => generate_model_id(ModelType::TypeEnvironment),
        _ => environment.id.to_string(),
    };
    let trimmed_name = environment.name.trim();

    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::insert()
        .into_table(EnvironmentIden::Table)
        .columns([
            EnvironmentIden::Id,
            EnvironmentIden::CreatedAt,
            EnvironmentIden::UpdatedAt,
            EnvironmentIden::EnvironmentId,
            EnvironmentIden::WorkspaceId,
            EnvironmentIden::Name,
            EnvironmentIden::Variables,
        ])
        .values_panic([
            id.as_str().into(),
            upsert_date(update_source, environment.created_at).into(),
            upsert_date(update_source, environment.updated_at).into(),
            environment.environment_id.into(),
            environment.workspace_id.into(),
            trimmed_name.into(),
            serde_json::to_string(&environment.variables)?.into(),
        ])
        .on_conflict(
            OnConflict::column(EnvironmentIden::Id)
                .update_columns([
                    EnvironmentIden::UpdatedAt,
                    EnvironmentIden::Name,
                    EnvironmentIden::Variables,
                ])
                .to_owned(),
        )
        .returning_all()
        .build_rusqlite(SqliteQueryBuilder);

    let mut stmt = db.prepare(sql.as_str())?;
    let m: Environment = stmt.query_row(&*params.as_params(), |row| row.try_into())?;
    emit_upserted_model(app_handle, &AnyModel::Environment(m.to_owned()), update_source);
    Ok(m)
}

pub async fn get_environment<R: Runtime>(
    app_handle: &AppHandle<R>,
    id: &str,
) -> Result<Environment> {
    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::select()
        .from(EnvironmentIden::Table)
        .column(Asterisk)
        .cond_where(Expr::col(EnvironmentIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    Ok(stmt.query_row(&*params.as_params(), |row| row.try_into())?)
}

pub async fn get_base_environment<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace_id: &str,
) -> Result<Environment> {
    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::select()
        .from(EnvironmentIden::Table)
        .column(Asterisk)
        .cond_where(
            Cond::all()
                .add(Expr::col(EnvironmentIden::WorkspaceId).eq(workspace_id))
                .add(Expr::col(EnvironmentIden::EnvironmentId).is_null()),
        )
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    Ok(stmt.query_row(&*params.as_params(), |row| row.try_into())?)
}

pub async fn get_plugin<R: Runtime>(app_handle: &AppHandle<R>, id: &str) -> Result<Plugin> {
    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::select()
        .from(PluginIden::Table)
        .column(Asterisk)
        .cond_where(Expr::col(EnvironmentIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    Ok(stmt.query_row(&*params.as_params(), |row| row.try_into())?)
}

pub async fn list_plugins<R: Runtime>(app_handle: &AppHandle<R>) -> Result<Vec<Plugin>> {
    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::select()
        .from(PluginIden::Table)
        .column(Asterisk)
        .order_by(PluginIden::CreatedAt, Order::Desc)
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
    Ok(items.map(|v| v.unwrap()).collect())
}

pub async fn upsert_plugin<R: Runtime>(
    app_handle: &AppHandle<R>,
    plugin: Plugin,
    update_source: &UpdateSource,
) -> Result<Plugin> {
    let id = match plugin.id.as_str() {
        "" => generate_model_id(ModelType::TypePlugin),
        _ => plugin.id.to_string(),
    };
    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::insert()
        .into_table(PluginIden::Table)
        .columns([
            PluginIden::Id,
            PluginIden::CreatedAt,
            PluginIden::UpdatedAt,
            PluginIden::CheckedAt,
            PluginIden::Directory,
            PluginIden::Url,
            PluginIden::Enabled,
        ])
        .values_panic([
            id.as_str().into(),
            upsert_date(update_source, plugin.created_at).into(),
            upsert_date(update_source, plugin.updated_at).into(),
            plugin.checked_at.into(),
            plugin.directory.into(),
            plugin.url.into(),
            plugin.enabled.into(),
        ])
        .on_conflict(
            OnConflict::column(PluginIden::Id)
                .update_columns([
                    PluginIden::UpdatedAt,
                    PluginIden::CheckedAt,
                    PluginIden::Directory,
                    PluginIden::Url,
                    PluginIden::Enabled,
                ])
                .to_owned(),
        )
        .returning_all()
        .build_rusqlite(SqliteQueryBuilder);

    let mut stmt = db.prepare(sql.as_str())?;
    let m: Plugin = stmt.query_row(&*params.as_params(), |row| row.try_into())?;
    emit_upserted_model(app_handle, &AnyModel::Plugin(m.to_owned()), update_source);
    Ok(m)
}

pub async fn delete_plugin<R: Runtime>(
    app_handle: &AppHandle<R>,
    id: &str,

    update_source: &UpdateSource,
) -> Result<Plugin> {
    let plugin = get_plugin(app_handle, id).await?;

    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::delete()
        .from_table(PluginIden::Table)
        .cond_where(Expr::col(PluginIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    db.execute(sql.as_str(), &*params.as_params())?;

    emit_deleted_model(app_handle, &AnyModel::Plugin(plugin.to_owned()), update_source);
    Ok(plugin)
}

pub async fn get_sync_state_for_model<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace_id: &str,
    model_id: &str,
) -> Result<Option<SyncState>> {
    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(SyncStateIden::Table)
        .column(Asterisk)
        .cond_where(
            Cond::all()
                .add(Expr::col(SyncStateIden::ModelId).eq(model_id))
                .add(Expr::col(SyncStateIden::WorkspaceId).eq(workspace_id)),
        )
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    Ok(stmt.query_row(&*params.as_params(), |row| row.try_into()).optional()?)
}

pub async fn list_sync_states_for_workspace<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace_id: &str,
    sync_dir: &Path,
) -> Result<Vec<SyncState>> {
    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(SyncStateIden::Table)
        .column(Asterisk)
        .cond_where(
            Cond::all()
                .add(Expr::col(SyncStateIden::WorkspaceId).eq(workspace_id))
                .add(Expr::col(SyncStateIden::SyncDir).eq(sync_dir.to_string_lossy())),
        )
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
    Ok(items.map(|v| v.unwrap()).collect())
}

pub async fn upsert_sync_state<R: Runtime>(
    app_handle: &AppHandle<R>,
    sync_state: SyncState,
) -> Result<SyncState> {
    let id = match sync_state.id.as_str() {
        "" => generate_model_id(ModelType::TypeSyncState),
        _ => sync_state.id.to_string(),
    };

    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::insert()
        .into_table(SyncStateIden::Table)
        .columns([
            SyncStateIden::Id,
            SyncStateIden::WorkspaceId,
            SyncStateIden::CreatedAt,
            SyncStateIden::UpdatedAt,
            SyncStateIden::FlushedAt,
            SyncStateIden::Checksum,
            SyncStateIden::ModelId,
            SyncStateIden::RelPath,
            SyncStateIden::SyncDir,
        ])
        .values_panic([
            id.as_str().into(),
            sync_state.workspace_id.into(),
            CurrentTimestamp.into(),
            CurrentTimestamp.into(),
            sync_state.flushed_at.into(),
            sync_state.checksum.into(),
            sync_state.model_id.into(),
            sync_state.rel_path.into(),
            sync_state.sync_dir.into(),
        ])
        .on_conflict(
            OnConflict::columns(vec![SyncStateIden::WorkspaceId, SyncStateIden::ModelId])
                .update_columns([
                    SyncStateIden::UpdatedAt,
                    SyncStateIden::FlushedAt,
                    SyncStateIden::Checksum,
                    SyncStateIden::RelPath,
                    SyncStateIden::SyncDir,
                ])
                .to_owned(),
        )
        .returning_all()
        .build_rusqlite(SqliteQueryBuilder);

    let mut stmt = db.prepare(sql.as_str())?;
    let m: SyncState = stmt.query_row(&*params.as_params(), |row| row.try_into())?;
    Ok(m)
}

pub async fn delete_sync_state<R: Runtime>(app_handle: &AppHandle<R>, id: &str) -> Result<()> {
    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::delete()
        .from_table(SyncStateIden::Table)
        .cond_where(Expr::col(SyncStateIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    db.execute(sql.as_str(), &*params.as_params())?;
    Ok(())
}

pub async fn debug_pool<R: Runtime>(app_handle: &AppHandle<R>) {
    let dbm = &*app_handle.state::<SqliteConnection>();
    let db = dbm.0.lock().await;
    debug!("Debug database state: {:?}", db.state());
}

pub fn generate_model_id(model: ModelType) -> String {
    let id = generate_id();
    format!("{}_{}", model.id_prefix(), id)
}

pub fn generate_id() -> String {
    let alphabet: [char; 57] = [
        '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
        'k', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'A', 'B', 'C',
        'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W',
        'X', 'Y', 'Z',
    ];

    nanoid!(10, &alphabet)
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct ModelPayload {
    pub model: AnyModel,
    pub update_source: UpdateSource,
    pub change: ModelChangeEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "gen_models.ts")]
pub enum ModelChangeEvent {
    Upsert,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "gen_models.ts")]
pub enum UpdateSource {
    Sync,
    Window { label: String },
    Plugin,
    Background,
    Import,
}

impl UpdateSource {
    pub fn from_window<R: Runtime>(window: &WebviewWindow<R>) -> Self {
        Self::Window {
            label: window.label().to_string(),
        }
    }
}

fn emit_upserted_model<R: Runtime>(
    app_handle: &AppHandle<R>,
    model: &AnyModel,
    update_source: &UpdateSource,
) {
    let payload = ModelPayload {
        model: model.to_owned(),
        update_source: update_source.to_owned(),
        change: ModelChangeEvent::Upsert,
    };

    app_handle.emit("upserted_model", payload).unwrap();
}

fn emit_deleted_model<R: Runtime>(
    app_handle: &AppHandle<R>,
    model: &AnyModel,
    update_source: &UpdateSource,
) {
    let payload = ModelPayload {
        model: model.to_owned(),
        update_source: update_source.to_owned(),
        change: ModelChangeEvent::Delete,
    };
    app_handle.emit("deleted_model", payload).unwrap();
}

pub fn listen_to_model_delete<F, R>(app_handle: &AppHandle<R>, handler: F)
where
    F: Fn(ModelPayload) + Send + 'static,
    R: Runtime,
{
    app_handle.listen_any("deleted_model", move |e| {
        match serde_json::from_str(e.payload()) {
            Ok(payload) => handler(payload),
            Err(e) => {
                warn!("Failed to deserialize deleted model {}", e);
                return;
            }
        };
    });
}

pub fn listen_to_model_upsert<F, R>(app_handle: &AppHandle<R>, handler: F)
where
    F: Fn(ModelPayload) + Send + 'static,
    R: Runtime,
{
    app_handle.listen_any("upserted_model", move |e| {
        match serde_json::from_str(e.payload()) {
            Ok(payload) => handler(payload),
            Err(e) => {
                warn!("Failed to deserialize upserted model {}", e);
                return;
            }
        };
    });
}

#[derive(Default, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WorkspaceExport {
    pub yaak_version: String,
    pub yaak_schema: i64,
    pub timestamp: NaiveDateTime,
    pub resources: BatchUpsertResult,
}

#[derive(Default, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BatchUpsertResult {
    pub workspaces: Vec<Workspace>,
    pub environments: Vec<Environment>,
    pub folders: Vec<Folder>,
    pub http_requests: Vec<HttpRequest>,
    pub grpc_requests: Vec<GrpcRequest>,
    pub websocket_requests: Vec<WebsocketRequest>,
}

pub async fn batch_upsert<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspaces: Vec<Workspace>,
    environments: Vec<Environment>,
    folders: Vec<Folder>,
    http_requests: Vec<HttpRequest>,
    grpc_requests: Vec<GrpcRequest>,
    websocket_requests: Vec<WebsocketRequest>,
    update_source: &UpdateSource,
) -> Result<BatchUpsertResult> {
    let mut imported_resources = BatchUpsertResult::default();

    if workspaces.len() > 0 {
        info!("Batch inserting {} workspaces", workspaces.len());
        for v in workspaces {
            let x = app_handle.queries().connect().await?.upsert(&v, update_source)?;
            imported_resources.workspaces.push(x.clone());
        }
    }

    if environments.len() > 0 {
        while imported_resources.environments.len() < environments.len() {
            for v in environments.clone() {
                if let Some(id) = v.environment_id.clone() {
                    let has_parent_to_import = environments.iter().find(|m| m.id == id).is_some();
                    let imported_parent =
                        imported_resources.environments.iter().find(|m| m.id == id);
                    // If there's also a parent to upsert, wait for that one
                    if imported_parent.is_none() && has_parent_to_import {
                        continue;
                    }
                }
                if let Some(_) = imported_resources.environments.iter().find(|f| f.id == v.id) {
                    continue;
                }
                let x = upsert_environment(&app_handle, v, update_source).await?;
                imported_resources.environments.push(x.clone());
            }
        }
        info!("Imported {} environments", imported_resources.environments.len());
    }

    if folders.len() > 0 {
        while imported_resources.folders.len() < folders.len() {
            for v in folders.clone() {
                if let Some(id) = v.folder_id.clone() {
                    let has_parent_to_import = folders.iter().find(|m| m.id == id).is_some();
                    let imported_parent = imported_resources.folders.iter().find(|m| m.id == id);
                    // If there's also a parent to upsert, wait for that one
                    if imported_parent.is_none() && has_parent_to_import {
                        continue;
                    }
                }
                if let Some(_) = imported_resources.folders.iter().find(|f| f.id == v.id) {
                    continue;
                }
                let x = app_handle.queries().connect().await?.upsert_folder(&v, update_source)?;
                imported_resources.folders.push(x.clone());
            }
        }
        info!("Imported {} folders", imported_resources.folders.len());
    }

    if http_requests.len() > 0 {
        for v in http_requests {
            let x = app_handle.queries().connect().await?.upsert(&v, update_source)?;
            imported_resources.http_requests.push(x.clone());
        }
        info!("Imported {} http_requests", imported_resources.http_requests.len());
    }

    if grpc_requests.len() > 0 {
        for v in grpc_requests {
            let x = app_handle.queries().connect().await?.upsert_grpc_request(&v, update_source)?;
            imported_resources.grpc_requests.push(x.clone());
        }
        info!("Imported {} grpc_requests", imported_resources.grpc_requests.len());
    }

    if websocket_requests.len() > 0 {
        for v in websocket_requests {
            let x = app_handle
                .queries()
                .connect()
                .await?
                .upsert_websocket_request(&v, update_source)?;
            imported_resources.websocket_requests.push(x.clone());
        }
        info!("Imported {} websocket_requests", imported_resources.websocket_requests.len());
    }

    Ok(imported_resources)
}

pub async fn get_workspace_export_resources<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace_ids: Vec<&str>,
    include_environments: bool,
) -> Result<WorkspaceExport> {
    let mut data = WorkspaceExport {
        yaak_version: app_handle.package_info().version.clone().to_string(),
        yaak_schema: 3,
        timestamp: Utc::now().naive_utc(),
        resources: BatchUpsertResult {
            workspaces: Vec::new(),
            environments: Vec::new(),
            folders: Vec::new(),
            http_requests: Vec::new(),
            grpc_requests: Vec::new(),
            websocket_requests: Vec::new(),
        },
    };

    for workspace_id in workspace_ids {
        data.resources
            .workspaces
            .push(app_handle.queries().connect().await?.find_one(WorkspaceIden::Id, workspace_id)?);
        data.resources.environments.append(&mut list_environments(app_handle, workspace_id).await?);
        data.resources
            .folders
            .append(&mut app_handle.queries().connect().await?.list_folders(workspace_id)?);
        data.resources.http_requests.append(&mut app_handle.queries().connect().await?.find_many(
            HttpRequestIden::WorkspaceId,
            workspace_id,
            None,
        )?);
        data.resources
            .grpc_requests
            .append(&mut app_handle.queries().connect().await?.list_grpc_requests(workspace_id)?);
        data.resources.websocket_requests.append(
            &mut app_handle.queries().connect().await?.list_websocket_requests(workspace_id)?,
        );
    }

    // Nuke environments if we don't want them
    if !include_environments {
        data.resources.environments.clear();
    }

    Ok(data)
}

// Generate the created_at or updated_at timestamps for an upsert operation, depending on the ID
// provided.
pub(crate) fn upsert_date(update_source: &UpdateSource, dt: NaiveDateTime) -> SimpleExpr {
    match update_source {
        // Sync and import operations always preserve timestamps
        UpdateSource::Sync | UpdateSource::Import => {
            if dt.and_utc().timestamp() == 0 {
                // Sometimes data won't have timestamps (partial data)
                Utc::now().naive_utc().into()
            } else {
                dt.into()
            }
        }
        // Other sources will always update to the latest time
        _ => Utc::now().naive_utc().into(),
    }
}
