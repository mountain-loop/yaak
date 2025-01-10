use crate::error::Error::ModelNotFound;
use crate::error::Result;
use crate::models::{
    AnyModel, CookieJar, CookieJarIden, Environment, EnvironmentIden, Folder, FolderIden,
    GrpcConnection, GrpcConnectionIden, GrpcConnectionState, GrpcEvent, GrpcEventIden, GrpcRequest,
    GrpcRequestIden, HttpRequest, HttpRequestIden, HttpResponse, HttpResponseHeader,
    HttpResponseIden, HttpResponseState, KeyValue, KeyValueIden, ModelType, Plugin, PluginIden,
    Settings, SettingsIden, SyncState, SyncStateIden, Workspace, WorkspaceIden, WorkspaceMeta,
    WorkspaceMetaIden,
};
use crate::plugin::SqliteConnection;
use chrono::{NaiveDateTime, Utc};
use log::{debug, error, info, warn};
use nanoid::nanoid;
use rusqlite::OptionalExtension;
use sea_query::ColumnRef::Asterisk;
use sea_query::Keyword::CurrentTimestamp;
use sea_query::{Cond, Expr, OnConflict, Order, Query, SqliteQueryBuilder};
use sea_query_rusqlite::RusqliteBinder;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Emitter, Listener, Manager, Runtime, WebviewWindow};
use ts_rs::TS;

const MAX_GRPC_CONNECTIONS_PER_REQUEST: usize = 20;
const MAX_HTTP_RESPONSES_PER_REQUEST: usize = MAX_GRPC_CONNECTIONS_PER_REQUEST;

pub async fn set_key_value_string<R: Runtime>(
    mgr: &WebviewWindow<R>,
    namespace: &str,
    key: &str,
    value: &str,
    update_source: &UpdateSource,
) -> (KeyValue, bool) {
    let encoded = serde_json::to_string(value);
    set_key_value_raw(mgr, namespace, key, &encoded.unwrap(), update_source).await
}

pub async fn set_key_value_int<R: Runtime>(
    mgr: &WebviewWindow<R>,
    namespace: &str,
    key: &str,
    value: i32,
    update_source: &UpdateSource,
) -> (KeyValue, bool) {
    let encoded = serde_json::to_string(&value);
    set_key_value_raw(mgr, namespace, key, &encoded.unwrap(), update_source).await
}

pub async fn get_key_value_string<R: Runtime>(
    mgr: &impl Manager<R>,
    namespace: &str,
    key: &str,
    default: &str,
) -> String {
    match get_key_value_raw(mgr, namespace, key).await {
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
    mgr: &impl Manager<R>,
    namespace: &str,
    key: &str,
    default: i32,
) -> i32 {
    match get_key_value_raw(mgr, namespace, key).await {
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
    w: &WebviewWindow<R>,
    namespace: &str,
    key: &str,
    value: &str,
    update_source: &UpdateSource,
) -> (KeyValue, bool) {
    let existing = get_key_value_raw(w, namespace, key).await;

    let dbm = &*w.state::<SqliteConnection>();
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
    emit_upserted_model(w, &AnyModel::KeyValue(m.to_owned()), update_source);
    (m, existing.is_none())
}

pub async fn list_key_values_raw<R: Runtime>(mgr: &impl Manager<R>) -> Result<Vec<KeyValue>> {
    let dbm = &*mgr.state::<SqliteConnection>();
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
    mgr: &impl Manager<R>,
    namespace: &str,
    key: &str,
) -> Option<KeyValue> {
    let dbm = &*mgr.state::<SqliteConnection>();
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

pub async fn list_workspaces<R: Runtime>(mgr: &impl Manager<R>) -> Result<Vec<Workspace>> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(WorkspaceIden::Table)
        .column(Asterisk)
        .order_by(WorkspaceIden::Name, Order::Asc)
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
    Ok(items.map(|v| v.unwrap()).collect())
}

pub async fn list_workspace_metas<R: Runtime>(mgr: &impl Manager<R>) -> Result<Vec<WorkspaceMeta>> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(WorkspaceMetaIden::Table)
        .column(Asterisk)
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
    Ok(items.map(|v| v.unwrap()).collect())
}

pub async fn get_workspace<R: Runtime>(mgr: &impl Manager<R>, id: &str) -> Result<Workspace> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(WorkspaceIden::Table)
        .column(Asterisk)
        .cond_where(Expr::col(WorkspaceIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    Ok(stmt.query_row(&*params.as_params(), |row| row.try_into())?)
}

pub async fn get_workspace_meta<R: Runtime>(
    mgr: &impl Manager<R>,
    workspace: &Workspace,
) -> Result<Option<WorkspaceMeta>> {
    let dbm = &*mgr.state::<SqliteConnection>();
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
    window: &WebviewWindow<R>,
    workspace: &Workspace,
    update_source: &UpdateSource,
) -> Result<WorkspaceMeta> {
    let workspace_meta = get_workspace_meta(window, workspace).await?;
    if let Some(m) = workspace_meta {
        return Ok(m);
    }

    upsert_workspace_meta(
        window,
        WorkspaceMeta {
            workspace_id: workspace.to_owned().id,
            ..Default::default()
        },
        update_source,
    )
    .await
}

pub async fn exists_workspace<R: Runtime>(mgr: &impl Manager<R>, id: &str) -> Result<bool> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(WorkspaceIden::Table)
        .column(Asterisk)
        .cond_where(Expr::col(WorkspaceIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    Ok(stmt.exists(&*params.as_params())?)
}

pub async fn upsert_workspace<R: Runtime>(
    window: &WebviewWindow<R>,
    workspace: Workspace,
    update_source: &UpdateSource,
) -> Result<Workspace> {
    let id = match workspace.id.as_str() {
        "" => generate_model_id(ModelType::TypeWorkspace),
        _ => workspace.id.to_string(),
    };
    let trimmed_name = workspace.name.trim();

    let dbm = &*window.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::insert()
        .into_table(WorkspaceIden::Table)
        .columns([
            WorkspaceIden::Id,
            WorkspaceIden::CreatedAt,
            WorkspaceIden::UpdatedAt,
            WorkspaceIden::Name,
            WorkspaceIden::Description,
            WorkspaceIden::SettingFollowRedirects,
            WorkspaceIden::SettingRequestTimeout,
            WorkspaceIden::SettingValidateCertificates,
        ])
        .values_panic([
            id.as_str().into(),
            timestamp_for_upsert(update_source, workspace.created_at).into(),
            timestamp_for_upsert(update_source, workspace.updated_at).into(),
            trimmed_name.into(),
            workspace.description.into(),
            workspace.setting_follow_redirects.into(),
            workspace.setting_request_timeout.into(),
            workspace.setting_validate_certificates.into(),
        ])
        .on_conflict(
            OnConflict::column(GrpcRequestIden::Id)
                .update_columns([
                    WorkspaceIden::UpdatedAt,
                    WorkspaceIden::Name,
                    WorkspaceIden::Description,
                    WorkspaceIden::SettingRequestTimeout,
                    WorkspaceIden::SettingFollowRedirects,
                    WorkspaceIden::SettingRequestTimeout,
                    WorkspaceIden::SettingValidateCertificates,
                ])
                .values([(WorkspaceIden::UpdatedAt, CurrentTimestamp.into())])
                .to_owned(),
        )
        .returning_all()
        .build_rusqlite(SqliteQueryBuilder);

    let mut stmt = db.prepare(&sql)?;
    let m: Workspace = stmt.query_row(&*params.as_params(), |row| row.try_into())?;
    emit_upserted_model(window, &AnyModel::Workspace(m.to_owned()), update_source);
    Ok(m)
}

pub async fn upsert_workspace_meta<R: Runtime>(
    window: &WebviewWindow<R>,
    workspace_meta: WorkspaceMeta,
    update_source: &UpdateSource,
) -> Result<WorkspaceMeta> {
    let id = match workspace_meta.id.as_str() {
        "" => generate_model_id(ModelType::TypeWorkspaceMeta),
        _ => workspace_meta.id.to_string(),
    };

    let dbm = &*window.app_handle().state::<SqliteConnection>();
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
            timestamp_for_upsert(update_source, workspace_meta.created_at).into(),
            timestamp_for_upsert(update_source, workspace_meta.updated_at).into(),
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
    emit_upserted_model(window, &AnyModel::WorkspaceMeta(m.to_owned()), update_source);
    Ok(m)
}

pub async fn delete_workspace<R: Runtime>(
    window: &WebviewWindow<R>,
    id: &str,
    update_source: &UpdateSource,
) -> Result<Workspace> {
    let workspace = get_workspace(window, id).await?;

    let dbm = &*window.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::delete()
        .from_table(WorkspaceIden::Table)
        .cond_where(Expr::col(WorkspaceIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    db.execute(sql.as_str(), &*params.as_params())?;

    for r in list_responses_by_workspace_id(window, id).await? {
        delete_http_response(window, &r.id, update_source).await?;
    }

    emit_deleted_model(window, &AnyModel::Workspace(workspace.to_owned()), update_source);
    Ok(workspace)
}

pub async fn get_cookie_jar<R: Runtime>(mgr: &impl Manager<R>, id: &str) -> Result<CookieJar> {
    let dbm = &*mgr.state::<SqliteConnection>();
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
    mgr: &impl Manager<R>,
    workspace_id: &str,
) -> Result<Vec<CookieJar>> {
    let dbm = &*mgr.state::<SqliteConnection>();
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
    window: &WebviewWindow<R>,
    id: &str,
    update_source: &UpdateSource,
) -> Result<CookieJar> {
    let cookie_jar = get_cookie_jar(window, id).await?;
    let dbm = &*window.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::delete()
        .from_table(CookieJarIden::Table)
        .cond_where(Expr::col(WorkspaceIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    db.execute(sql.as_str(), &*params.as_params())?;

    emit_deleted_model(window, &AnyModel::CookieJar(cookie_jar.to_owned()), update_source);
    Ok(cookie_jar)
}

pub async fn duplicate_grpc_request<R: Runtime>(
    window: &WebviewWindow<R>,
    id: &str,
    update_source: &UpdateSource,
) -> Result<GrpcRequest> {
    let mut request = match get_grpc_request(window, id).await? {
        Some(r) => r,
        None => {
            return Err(ModelNotFound(id.to_string()));
        }
    };
    request.sort_priority = request.sort_priority + 0.001;
    request.id = "".to_string();
    upsert_grpc_request(window, request, update_source).await
}

pub async fn delete_grpc_request<R: Runtime>(
    window: &WebviewWindow<R>,
    id: &str,
    update_source: &UpdateSource,
) -> Result<GrpcRequest> {
    let grpc_request = match get_grpc_request(window, id).await? {
        Some(r) => r,
        None => {
            return Err(ModelNotFound(id.to_string()));
        }
    };

    let dbm = &*window.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::delete()
        .from_table(GrpcRequestIden::Table)
        .cond_where(Expr::col(GrpcRequestIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    db.execute(sql.as_str(), &*params.as_params())?;

    emit_deleted_model(window, &AnyModel::GrpcRequest(grpc_request.to_owned()), update_source);
    Ok(grpc_request)
}

pub async fn upsert_grpc_request<R: Runtime>(
    window: &WebviewWindow<R>,
    request: GrpcRequest,
    update_source: &UpdateSource,
) -> Result<GrpcRequest> {
    let id = match request.id.as_str() {
        "" => generate_model_id(ModelType::TypeGrpcRequest),
        _ => request.id.to_string(),
    };
    let trimmed_name = request.name.trim();

    let dbm = &*window.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::insert()
        .into_table(GrpcRequestIden::Table)
        .columns([
            GrpcRequestIden::Id,
            GrpcRequestIden::CreatedAt,
            GrpcRequestIden::UpdatedAt,
            GrpcRequestIden::Name,
            GrpcRequestIden::Description,
            GrpcRequestIden::WorkspaceId,
            GrpcRequestIden::FolderId,
            GrpcRequestIden::SortPriority,
            GrpcRequestIden::Url,
            GrpcRequestIden::Service,
            GrpcRequestIden::Method,
            GrpcRequestIden::Message,
            GrpcRequestIden::AuthenticationType,
            GrpcRequestIden::Authentication,
            GrpcRequestIden::Metadata,
        ])
        .values_panic([
            id.into(),
            timestamp_for_upsert(update_source, request.created_at).into(),
            timestamp_for_upsert(update_source, request.updated_at).into(),
            trimmed_name.into(),
            request.description.into(),
            request.workspace_id.into(),
            request.folder_id.as_ref().map(|s| s.as_str()).into(),
            request.sort_priority.into(),
            request.url.into(),
            request.service.as_ref().map(|s| s.as_str()).into(),
            request.method.as_ref().map(|s| s.as_str()).into(),
            request.message.into(),
            request.authentication_type.as_ref().map(|s| s.as_str()).into(),
            serde_json::to_string(&request.authentication)?.into(),
            serde_json::to_string(&request.metadata)?.into(),
        ])
        .on_conflict(
            OnConflict::column(GrpcRequestIden::Id)
                .update_columns([
                    GrpcRequestIden::UpdatedAt,
                    GrpcRequestIden::WorkspaceId,
                    GrpcRequestIden::Name,
                    GrpcRequestIden::Description,
                    GrpcRequestIden::FolderId,
                    GrpcRequestIden::SortPriority,
                    GrpcRequestIden::Url,
                    GrpcRequestIden::Service,
                    GrpcRequestIden::Method,
                    GrpcRequestIden::Message,
                    GrpcRequestIden::AuthenticationType,
                    GrpcRequestIden::Authentication,
                    GrpcRequestIden::Metadata,
                ])
                .to_owned(),
        )
        .returning_all()
        .build_rusqlite(SqliteQueryBuilder);

    let mut stmt = db.prepare(sql.as_str())?;
    let m: GrpcRequest = stmt.query_row(&*params.as_params(), |row| row.try_into())?;
    emit_upserted_model(window, &AnyModel::GrpcRequest(m.to_owned()), update_source);
    Ok(m)
}

pub async fn get_grpc_request<R: Runtime>(
    mgr: &impl Manager<R>,
    id: &str,
) -> Result<Option<GrpcRequest>> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::select()
        .from(GrpcRequestIden::Table)
        .column(Asterisk)
        .cond_where(Expr::col(GrpcRequestIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    Ok(stmt.query_row(&*params.as_params(), |row| row.try_into()).optional()?)
}

pub async fn list_grpc_requests<R: Runtime>(
    mgr: &impl Manager<R>,
    workspace_id: &str,
) -> Result<Vec<GrpcRequest>> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(GrpcRequestIden::Table)
        .cond_where(Expr::col(GrpcRequestIden::WorkspaceId).eq(workspace_id))
        .column(Asterisk)
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
    Ok(items.map(|v| v.unwrap()).collect())
}

pub async fn upsert_grpc_connection<R: Runtime>(
    window: &WebviewWindow<R>,
    connection: &GrpcConnection,
    update_source: &UpdateSource,
) -> Result<GrpcConnection> {
    let connections =
        list_http_responses_for_request(window, connection.request_id.as_str(), None).await?;
    for c in connections.iter().skip(MAX_GRPC_CONNECTIONS_PER_REQUEST - 1) {
        debug!("Deleting old grpc connection {}", c.id);
        delete_grpc_connection(window, c.id.as_str(), update_source).await?;
    }

    let id = match connection.id.as_str() {
        "" => generate_model_id(ModelType::TypeGrpcConnection),
        _ => connection.id.to_string(),
    };
    let dbm = &*window.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::insert()
        .into_table(GrpcConnectionIden::Table)
        .columns([
            GrpcConnectionIden::Id,
            GrpcConnectionIden::CreatedAt,
            GrpcConnectionIden::UpdatedAt,
            GrpcConnectionIden::WorkspaceId,
            GrpcConnectionIden::RequestId,
            GrpcConnectionIden::Service,
            GrpcConnectionIden::Method,
            GrpcConnectionIden::Elapsed,
            GrpcConnectionIden::State,
            GrpcConnectionIden::Status,
            GrpcConnectionIden::Error,
            GrpcConnectionIden::Trailers,
            GrpcConnectionIden::Url,
        ])
        .values_panic([
            id.as_str().into(),
            timestamp_for_upsert(update_source, connection.created_at).into(),
            timestamp_for_upsert(update_source, connection.updated_at).into(),
            connection.workspace_id.as_str().into(),
            connection.request_id.as_str().into(),
            connection.service.as_str().into(),
            connection.method.as_str().into(),
            connection.elapsed.into(),
            serde_json::to_value(&connection.state)?.as_str().into(),
            connection.status.into(),
            connection.error.as_ref().map(|s| s.as_str()).into(),
            serde_json::to_string(&connection.trailers)?.into(),
            connection.url.as_str().into(),
        ])
        .on_conflict(
            OnConflict::column(GrpcConnectionIden::Id)
                .update_columns([
                    GrpcConnectionIden::UpdatedAt,
                    GrpcConnectionIden::Service,
                    GrpcConnectionIden::Method,
                    GrpcConnectionIden::Elapsed,
                    GrpcConnectionIden::Status,
                    GrpcConnectionIden::State,
                    GrpcConnectionIden::Error,
                    GrpcConnectionIden::Trailers,
                    GrpcConnectionIden::Url,
                ])
                .to_owned(),
        )
        .returning_all()
        .build_rusqlite(SqliteQueryBuilder);

    let mut stmt = db.prepare(sql.as_str())?;
    let m: GrpcConnection = stmt.query_row(&*params.as_params(), |row| row.try_into())?;
    emit_upserted_model(window, &AnyModel::GrpcConnection(m.to_owned()), update_source);
    Ok(m)
}

pub async fn get_grpc_connection<R: Runtime>(
    mgr: &impl Manager<R>,
    id: &str,
) -> Result<GrpcConnection> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(GrpcConnectionIden::Table)
        .column(Asterisk)
        .cond_where(Expr::col(GrpcConnectionIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    Ok(stmt.query_row(&*params.as_params(), |row| row.try_into())?)
}

pub async fn list_grpc_connections_for_workspace<R: Runtime>(
    mgr: &impl Manager<R>,
    workspace_id: &str,
) -> Result<Vec<GrpcConnection>> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::select()
        .from(GrpcConnectionIden::Table)
        .cond_where(Expr::col(GrpcConnectionIden::WorkspaceId).eq(workspace_id))
        .column(Asterisk)
        .order_by(GrpcConnectionIden::CreatedAt, Order::Desc)
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
    Ok(items.map(|v| v.unwrap()).collect())
}

pub async fn list_grpc_connections_for_request<R: Runtime>(
    mgr: &impl Manager<R>,
    request_id: &str,
) -> Result<Vec<GrpcConnection>> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::select()
        .from(GrpcConnectionIden::Table)
        .cond_where(Expr::col(GrpcConnectionIden::RequestId).eq(request_id))
        .column(Asterisk)
        .order_by(GrpcConnectionIden::CreatedAt, Order::Desc)
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
    Ok(items.map(|v| v.unwrap()).collect())
}

pub async fn delete_grpc_connection<R: Runtime>(
    window: &WebviewWindow<R>,
    id: &str,
    update_source: &UpdateSource,
) -> Result<GrpcConnection> {
    let m = get_grpc_connection(window, id).await?;

    let dbm = &*window.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::delete()
        .from_table(GrpcConnectionIden::Table)
        .cond_where(Expr::col(GrpcConnectionIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);

    db.execute(sql.as_str(), &*params.as_params())?;
    emit_deleted_model(window, &AnyModel::GrpcConnection(m.to_owned()), update_source);
    Ok(m)
}

pub async fn delete_all_grpc_connections<R: Runtime>(
    window: &WebviewWindow<R>,
    request_id: &str,
    update_source: &UpdateSource,
) -> Result<()> {
    for r in list_grpc_connections_for_request(window, request_id).await? {
        delete_grpc_connection(window, &r.id, update_source).await?;
    }
    Ok(())
}

pub async fn delete_all_grpc_connections_for_workspace<R: Runtime>(
    window: &WebviewWindow<R>,
    workspace_id: &str,
    update_source: &UpdateSource,
) -> Result<()> {
    for r in list_grpc_connections_for_workspace(window, workspace_id).await? {
        delete_grpc_connection(window, &r.id, update_source).await?;
    }
    Ok(())
}

pub async fn upsert_grpc_event<R: Runtime>(
    window: &WebviewWindow<R>,
    event: &GrpcEvent,
    update_source: &UpdateSource,
) -> Result<GrpcEvent> {
    let id = match event.id.as_str() {
        "" => generate_model_id(ModelType::TypeGrpcEvent),
        _ => event.id.to_string(),
    };

    let dbm = &*window.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::insert()
        .into_table(GrpcEventIden::Table)
        .columns([
            GrpcEventIden::Id,
            GrpcEventIden::CreatedAt,
            GrpcEventIden::UpdatedAt,
            GrpcEventIden::WorkspaceId,
            GrpcEventIden::RequestId,
            GrpcEventIden::ConnectionId,
            GrpcEventIden::Content,
            GrpcEventIden::EventType,
            GrpcEventIden::Metadata,
            GrpcEventIden::Status,
            GrpcEventIden::Error,
        ])
        .values_panic([
            id.as_str().into(),
            timestamp_for_upsert(update_source, event.created_at).into(),
            timestamp_for_upsert(update_source, event.updated_at).into(),
            event.workspace_id.as_str().into(),
            event.request_id.as_str().into(),
            event.connection_id.as_str().into(),
            event.content.as_str().into(),
            serde_json::to_string(&event.event_type)?.into(),
            serde_json::to_string(&event.metadata)?.into(),
            event.status.into(),
            event.error.as_ref().map(|s| s.as_str()).into(),
        ])
        .on_conflict(
            OnConflict::column(GrpcEventIden::Id)
                .update_columns([
                    GrpcEventIden::UpdatedAt,
                    GrpcEventIden::Content,
                    GrpcEventIden::EventType,
                    GrpcEventIden::Metadata,
                    GrpcEventIden::Status,
                    GrpcEventIden::Error,
                ])
                .to_owned(),
        )
        .returning_all()
        .build_rusqlite(SqliteQueryBuilder);

    let mut stmt = db.prepare(sql.as_str())?;
    let m: GrpcEvent = stmt.query_row(&*params.as_params(), |row| row.try_into())?;
    emit_upserted_model(window, &AnyModel::GrpcEvent(m.to_owned()), update_source);
    Ok(m)
}

pub async fn get_grpc_event<R: Runtime>(mgr: &impl Manager<R>, id: &str) -> Result<GrpcEvent> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(GrpcEventIden::Table)
        .column(Asterisk)
        .cond_where(Expr::col(GrpcEventIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    Ok(stmt.query_row(&*params.as_params(), |row| row.try_into())?)
}

pub async fn list_grpc_events<R: Runtime>(
    mgr: &impl Manager<R>,
    connection_id: &str,
) -> Result<Vec<GrpcEvent>> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::select()
        .from(GrpcEventIden::Table)
        .cond_where(Expr::col(GrpcEventIden::ConnectionId).eq(connection_id))
        .column(Asterisk)
        .order_by(GrpcEventIden::CreatedAt, Order::Asc)
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
    Ok(items.map(|v| v.unwrap()).collect())
}

pub async fn upsert_cookie_jar<R: Runtime>(
    window: &WebviewWindow<R>,
    cookie_jar: &CookieJar,
    update_source: &UpdateSource,
) -> Result<CookieJar> {
    let id = match cookie_jar.id.as_str() {
        "" => generate_model_id(ModelType::TypeCookieJar),
        _ => cookie_jar.id.to_string(),
    };
    let trimmed_name = cookie_jar.name.trim();

    let dbm = &*window.app_handle().state::<SqliteConnection>();
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
            timestamp_for_upsert(update_source, cookie_jar.created_at).into(),
            timestamp_for_upsert(update_source, cookie_jar.updated_at).into(),
            cookie_jar.workspace_id.as_str().into(),
            trimmed_name.into(),
            serde_json::to_string(&cookie_jar.cookies)?.into(),
        ])
        .on_conflict(
            OnConflict::column(GrpcEventIden::Id)
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
    emit_upserted_model(window, &AnyModel::CookieJar(m.to_owned()), update_source);
    Ok(m)
}

pub async fn ensure_base_environment<R: Runtime>(
    window: &WebviewWindow<R>,
    workspace_id: &str,
) -> Result<()> {
    let environments = list_environments(window, workspace_id).await?;
    let base_environment =
        environments.iter().find(|e| e.environment_id == None && e.workspace_id == workspace_id);

    if let None = base_environment {
        info!("Creating base environment for {workspace_id}");
        upsert_environment(
            window,
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
    mgr: &impl Manager<R>,
    workspace_id: &str,
) -> Result<Vec<Environment>> {
    let environments: Vec<Environment> = {
        let dbm = &*mgr.state::<SqliteConnection>();
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
    window: &WebviewWindow<R>,
    id: &str,
    update_source: &UpdateSource,
) -> Result<Environment> {
    let env = get_environment(window, id).await?;

    let dbm = &*window.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::delete()
        .from_table(EnvironmentIden::Table)
        .cond_where(Expr::col(EnvironmentIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);

    db.execute(sql.as_str(), &*params.as_params())?;

    emit_deleted_model(window, &AnyModel::Environment(env.to_owned()), update_source);
    Ok(env)
}

const SETTINGS_ID: &str = "default";

async fn get_settings<R: Runtime>(mgr: &impl Manager<R>) -> Result<Option<Settings>> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::select()
        .from(SettingsIden::Table)
        .column(Asterisk)
        .cond_where(Expr::col(SettingsIden::Id).eq(SETTINGS_ID))
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    Ok(stmt.query_row(&*params.as_params(), |row| row.try_into()).optional()?)
}

pub async fn get_or_create_settings<R: Runtime>(mgr: &impl Manager<R>) -> Settings {
    match get_settings(mgr).await {
        Ok(Some(settings)) => return settings,
        Err(e) => panic!("Failed to get settings {e:?}"),
        Ok(None) => {}
    };

    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::insert()
        .into_table(SettingsIden::Table)
        .columns([SettingsIden::Id])
        .values_panic([SETTINGS_ID.into()])
        .returning_all()
        .build_rusqlite(SqliteQueryBuilder);

    let mut stmt = db.prepare(sql.as_str()).expect("Failed to prepare Settings insert");
    stmt.query_row(&*params.as_params(), |row| row.try_into()).expect("Failed to insert Settings")
}

pub async fn update_settings<R: Runtime>(
    window: &WebviewWindow<R>,
    settings: Settings,
    update_source: &UpdateSource,
) -> Result<Settings> {
    // Correct for the bug where created_at was being updated by mistake
    let created_at = if settings.created_at > settings.updated_at {
        settings.updated_at
    } else {
        settings.created_at
    };

    let dbm = &*window.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::update()
        .table(SettingsIden::Table)
        .cond_where(Expr::col(SettingsIden::Id).eq("default"))
        .values([
            (SettingsIden::Id, "default".into()),
            (SettingsIden::CreatedAt, created_at.into()),
            (SettingsIden::UpdatedAt, CurrentTimestamp.into()),
            (SettingsIden::Appearance, settings.appearance.as_str().into()),
            (SettingsIden::ThemeDark, settings.theme_dark.as_str().into()),
            (SettingsIden::ThemeLight, settings.theme_light.as_str().into()),
            (SettingsIden::UpdateChannel, settings.update_channel.into()),
            (SettingsIden::InterfaceFontSize, settings.interface_font_size.into()),
            (SettingsIden::InterfaceScale, settings.interface_scale.into()),
            (SettingsIden::EditorFontSize, settings.editor_font_size.into()),
            (SettingsIden::EditorKeymap, settings.editor_keymap.to_string().into()),
            (SettingsIden::EditorSoftWrap, settings.editor_soft_wrap.into()),
            (SettingsIden::Telemetry, settings.telemetry.into()),
            (SettingsIden::OpenWorkspaceNewWindow, settings.open_workspace_new_window.into()),
            (
                SettingsIden::Proxy,
                (match settings.proxy {
                    None => None,
                    Some(p) => Some(serde_json::to_string(&p)?),
                })
                .into(),
            ),
        ])
        .returning_all()
        .build_rusqlite(SqliteQueryBuilder);

    let mut stmt = db.prepare(sql.as_str())?;
    let m: Settings = stmt.query_row(&*params.as_params(), |row| row.try_into())?;
    emit_upserted_model(window, &AnyModel::Settings(m.to_owned()), update_source);
    Ok(m)
}

pub async fn upsert_environment<R: Runtime>(
    window: &WebviewWindow<R>,
    environment: Environment,
    update_source: &UpdateSource,
) -> Result<Environment> {
    let id = match environment.id.as_str() {
        "" => generate_model_id(ModelType::TypeEnvironment),
        _ => environment.id.to_string(),
    };
    let trimmed_name = environment.name.trim();

    let dbm = &*window.app_handle().state::<SqliteConnection>();
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
            timestamp_for_upsert(update_source, environment.created_at).into(),
            timestamp_for_upsert(update_source, environment.updated_at).into(),
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
    emit_upserted_model(window, &AnyModel::Environment(m.to_owned()), update_source);
    Ok(m)
}

pub async fn get_environment<R: Runtime>(mgr: &impl Manager<R>, id: &str) -> Result<Environment> {
    let dbm = &*mgr.state::<SqliteConnection>();
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
    mgr: &impl Manager<R>,
    workspace_id: &str,
) -> Result<Environment> {
    let dbm = &*mgr.state::<SqliteConnection>();
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

pub async fn get_plugin<R: Runtime>(mgr: &impl Manager<R>, id: &str) -> Result<Plugin> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::select()
        .from(PluginIden::Table)
        .column(Asterisk)
        .cond_where(Expr::col(EnvironmentIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    Ok(stmt.query_row(&*params.as_params(), |row| row.try_into())?)
}

pub async fn list_plugins<R: Runtime>(mgr: &impl Manager<R>) -> Result<Vec<Plugin>> {
    let dbm = &*mgr.state::<SqliteConnection>();
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
    window: &WebviewWindow<R>,
    plugin: Plugin,
    update_source: &UpdateSource,
) -> Result<Plugin> {
    let id = match plugin.id.as_str() {
        "" => generate_model_id(ModelType::TypePlugin),
        _ => plugin.id.to_string(),
    };
    let dbm = &*window.app_handle().state::<SqliteConnection>();
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
            timestamp_for_upsert(update_source, plugin.created_at).into(),
            timestamp_for_upsert(update_source, plugin.updated_at).into(),
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
    emit_upserted_model(window, &AnyModel::Plugin(m.to_owned()), update_source);
    Ok(m)
}

pub async fn delete_plugin<R: Runtime>(
    window: &WebviewWindow<R>,
    id: &str,

    update_source: &UpdateSource,
) -> Result<Plugin> {
    let plugin = get_plugin(window, id).await?;

    let dbm = &*window.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::delete()
        .from_table(PluginIden::Table)
        .cond_where(Expr::col(PluginIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    db.execute(sql.as_str(), &*params.as_params())?;

    emit_deleted_model(window, &AnyModel::Plugin(plugin.to_owned()), update_source);
    Ok(plugin)
}

pub async fn get_folder<R: Runtime>(mgr: &impl Manager<R>, id: &str) -> Result<Folder> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::select()
        .from(FolderIden::Table)
        .column(Asterisk)
        .cond_where(Expr::col(FolderIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    Ok(stmt.query_row(&*params.as_params(), |row| row.try_into())?)
}

pub async fn list_folders<R: Runtime>(
    mgr: &impl Manager<R>,
    workspace_id: &str,
) -> Result<Vec<Folder>> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::select()
        .from(FolderIden::Table)
        .cond_where(Expr::col(FolderIden::WorkspaceId).eq(workspace_id))
        .column(Asterisk)
        .order_by(FolderIden::CreatedAt, Order::Desc)
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
    Ok(items.map(|v| v.unwrap()).collect())
}

pub async fn delete_folder<R: Runtime>(
    window: &WebviewWindow<R>,
    id: &str,

    update_source: &UpdateSource,
) -> Result<Folder> {
    let folder = get_folder(window, id).await?;

    let dbm = &*window.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::delete()
        .from_table(FolderIden::Table)
        .cond_where(Expr::col(FolderIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    db.execute(sql.as_str(), &*params.as_params())?;

    emit_deleted_model(window, &AnyModel::Folder(folder.to_owned()), update_source);
    Ok(folder)
}

pub async fn upsert_folder<R: Runtime>(
    window: &WebviewWindow<R>,
    folder: Folder,

    update_source: &UpdateSource,
) -> Result<Folder> {
    let id = match folder.id.as_str() {
        "" => generate_model_id(ModelType::TypeFolder),
        _ => folder.id.to_string(),
    };
    let trimmed_name = folder.name.trim();

    let dbm = &*window.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::insert()
        .into_table(FolderIden::Table)
        .columns([
            FolderIden::Id,
            FolderIden::CreatedAt,
            FolderIden::UpdatedAt,
            FolderIden::WorkspaceId,
            FolderIden::FolderId,
            FolderIden::Name,
            FolderIden::Description,
            FolderIden::SortPriority,
        ])
        .values_panic([
            id.as_str().into(),
            timestamp_for_upsert(update_source, folder.created_at).into(),
            timestamp_for_upsert(update_source, folder.updated_at).into(),
            folder.workspace_id.as_str().into(),
            folder.folder_id.as_ref().map(|s| s.as_str()).into(),
            trimmed_name.into(),
            folder.description.into(),
            folder.sort_priority.into(),
        ])
        .on_conflict(
            OnConflict::column(GrpcEventIden::Id)
                .update_columns([
                    FolderIden::UpdatedAt,
                    FolderIden::Name,
                    FolderIden::Description,
                    FolderIden::FolderId,
                    FolderIden::SortPriority,
                ])
                .to_owned(),
        )
        .returning_all()
        .build_rusqlite(SqliteQueryBuilder);

    let mut stmt = db.prepare(sql.as_str())?;
    let m: Folder = stmt.query_row(&*params.as_params(), |row| row.try_into())?;
    emit_upserted_model(window, &AnyModel::Folder(m.to_owned()), update_source);
    Ok(m)
}

pub async fn duplicate_http_request<R: Runtime>(
    window: &WebviewWindow<R>,
    id: &str,
    update_source: &UpdateSource,
) -> Result<HttpRequest> {
    let mut request = match get_http_request(window, id).await? {
        None => return Err(ModelNotFound(id.to_string())),
        Some(r) => r,
    };
    request.id = "".to_string();
    request.sort_priority = request.sort_priority + 0.001;
    upsert_http_request(window, request, update_source).await
}

pub async fn duplicate_folder<R: Runtime>(
    window: &WebviewWindow<R>,
    src_folder: &Folder,
) -> Result<()> {
    let workspace_id = src_folder.workspace_id.as_str();

    let http_requests = list_http_requests(window, workspace_id)
        .await?
        .into_iter()
        .filter(|m| m.folder_id.as_ref() == Some(&src_folder.id));

    let grpc_requests = list_grpc_requests(window, workspace_id)
        .await?
        .into_iter()
        .filter(|m| m.folder_id.as_ref() == Some(&src_folder.id));

    let folders = list_folders(window, workspace_id)
        .await?
        .into_iter()
        .filter(|m| m.folder_id.as_ref() == Some(&src_folder.id));

    let new_folder = upsert_folder(
        window,
        Folder {
            id: "".into(),
            sort_priority: src_folder.sort_priority + 0.001,
            ..src_folder.clone()
        },
        &UpdateSource::Window,
    )
    .await?;

    for m in http_requests {
        upsert_http_request(
            window,
            HttpRequest {
                id: "".into(),
                folder_id: Some(new_folder.id.clone()),
                sort_priority: m.sort_priority + 0.001,
                ..m
            },
            &UpdateSource::Window,
        )
        .await?;
    }
    for m in grpc_requests {
        upsert_grpc_request(
            window,
            GrpcRequest {
                id: "".into(),
                folder_id: Some(new_folder.id.clone()),
                sort_priority: m.sort_priority + 0.001,
                ..m
            },
            &UpdateSource::Window,
        )
        .await?;
    }
    for m in folders {
        // Recurse down
        Box::pin(duplicate_folder(
            window,
            &Folder {
                folder_id: Some(new_folder.id.clone()),
                ..m
            },
        ))
        .await?;
    }
    Ok(())
}

pub async fn upsert_http_request<R: Runtime>(
    window: &WebviewWindow<R>,
    request: HttpRequest,
    update_source: &UpdateSource,
) -> Result<HttpRequest> {
    let id = match request.id.as_str() {
        "" => generate_model_id(ModelType::TypeHttpRequest),
        _ => request.id.to_string(),
    };
    let trimmed_name = request.name.trim();

    let dbm = &*window.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::insert()
        .into_table(HttpRequestIden::Table)
        .columns([
            HttpRequestIden::Id,
            HttpRequestIden::CreatedAt,
            HttpRequestIden::UpdatedAt,
            HttpRequestIden::WorkspaceId,
            HttpRequestIden::FolderId,
            HttpRequestIden::Name,
            HttpRequestIden::Description,
            HttpRequestIden::Url,
            HttpRequestIden::UrlParameters,
            HttpRequestIden::Method,
            HttpRequestIden::Body,
            HttpRequestIden::BodyType,
            HttpRequestIden::Authentication,
            HttpRequestIden::AuthenticationType,
            HttpRequestIden::Headers,
            HttpRequestIden::SortPriority,
        ])
        .values_panic([
            id.as_str().into(),
            timestamp_for_upsert(update_source, request.created_at).into(),
            timestamp_for_upsert(update_source, request.updated_at).into(),
            request.workspace_id.into(),
            request.folder_id.as_ref().map(|s| s.as_str()).into(),
            trimmed_name.into(),
            request.description.into(),
            request.url.into(),
            serde_json::to_string(&request.url_parameters)?.into(),
            request.method.into(),
            serde_json::to_string(&request.body)?.into(),
            request.body_type.as_ref().map(|s| s.as_str()).into(),
            serde_json::to_string(&request.authentication)?.into(),
            request.authentication_type.as_ref().map(|s| s.as_str()).into(),
            serde_json::to_string(&request.headers)?.into(),
            request.sort_priority.into(),
        ])
        .on_conflict(
            OnConflict::column(GrpcEventIden::Id)
                .update_columns([
                    HttpRequestIden::UpdatedAt,
                    HttpRequestIden::WorkspaceId,
                    HttpRequestIden::Name,
                    HttpRequestIden::Description,
                    HttpRequestIden::FolderId,
                    HttpRequestIden::Method,
                    HttpRequestIden::Headers,
                    HttpRequestIden::Body,
                    HttpRequestIden::BodyType,
                    HttpRequestIden::Authentication,
                    HttpRequestIden::AuthenticationType,
                    HttpRequestIden::Url,
                    HttpRequestIden::UrlParameters,
                    HttpRequestIden::SortPriority,
                ])
                .to_owned(),
        )
        .returning_all()
        .build_rusqlite(SqliteQueryBuilder);

    let mut stmt = db.prepare(sql.as_str())?;
    let m: HttpRequest = stmt.query_row(&*params.as_params(), |row| row.try_into())?;
    emit_upserted_model(window, &AnyModel::HttpRequest(m.to_owned()), update_source);
    Ok(m)
}

pub async fn list_http_requests<R: Runtime>(
    mgr: &impl Manager<R>,
    workspace_id: &str,
) -> Result<Vec<HttpRequest>> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(HttpRequestIden::Table)
        .cond_where(Expr::col(HttpRequestIden::WorkspaceId).eq(workspace_id))
        .column(Asterisk)
        .order_by(HttpRequestIden::CreatedAt, Order::Desc)
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
    Ok(items.map(|v| v.unwrap()).collect())
}

pub async fn get_http_request<R: Runtime>(
    mgr: &impl Manager<R>,
    id: &str,
) -> Result<Option<HttpRequest>> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::select()
        .from(HttpRequestIden::Table)
        .column(Asterisk)
        .cond_where(Expr::col(HttpRequestIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    Ok(stmt.query_row(&*params.as_params(), |row| row.try_into()).optional()?)
}

pub async fn delete_http_request<R: Runtime>(
    window: &WebviewWindow<R>,
    id: &str,
    update_source: &UpdateSource,
) -> Result<HttpRequest> {
    let req = match get_http_request(window, id).await? {
        None => return Err(ModelNotFound(id.to_string())),
        Some(r) => r,
    };

    // DB deletes will cascade but this will delete the files
    delete_all_http_responses_for_request(window, id, update_source).await?;

    let dbm = &*window.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::delete()
        .from_table(HttpRequestIden::Table)
        .cond_where(Expr::col(HttpRequestIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    db.execute(sql.as_str(), &*params.as_params())?;

    emit_deleted_model(window, &AnyModel::HttpRequest(req.to_owned()), update_source);
    Ok(req)
}

pub async fn create_default_http_response<R: Runtime>(
    window: &WebviewWindow<R>,
    request_id: &str,
    update_source: &UpdateSource,
) -> Result<HttpResponse> {
    create_http_response(
        &window,
        request_id,
        0,
        0,
        "",
        HttpResponseState::Initialized,
        0,
        None,
        None,
        None,
        vec![],
        None,
        None,
        update_source,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_http_response<R: Runtime>(
    window: &WebviewWindow<R>,
    request_id: &str,
    elapsed: i64,
    elapsed_headers: i64,
    url: &str,
    state: HttpResponseState,
    status: i64,
    status_reason: Option<&str>,
    content_length: Option<i64>,
    body_path: Option<&str>,
    headers: Vec<HttpResponseHeader>,
    version: Option<&str>,
    remote_addr: Option<&str>,
    update_source: &UpdateSource,
) -> Result<HttpResponse> {
    let responses = list_http_responses_for_request(window, request_id, None).await?;
    for response in responses.iter().skip(MAX_HTTP_RESPONSES_PER_REQUEST - 1) {
        debug!("Deleting old response {}", response.id);
        delete_http_response(window, response.id.as_str(), update_source).await?;
    }

    let req = match get_http_request(window, request_id).await? {
        None => return Err(ModelNotFound(request_id.to_string())),
        Some(r) => r,
    };
    let id = generate_model_id(ModelType::TypeHttpResponse);
    let dbm = &*window.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::insert()
        .into_table(HttpResponseIden::Table)
        .columns([
            HttpResponseIden::Id,
            HttpResponseIden::CreatedAt,
            HttpResponseIden::UpdatedAt,
            HttpResponseIden::RequestId,
            HttpResponseIden::WorkspaceId,
            HttpResponseIden::Elapsed,
            HttpResponseIden::ElapsedHeaders,
            HttpResponseIden::Url,
            HttpResponseIden::State,
            HttpResponseIden::Status,
            HttpResponseIden::StatusReason,
            HttpResponseIden::ContentLength,
            HttpResponseIden::BodyPath,
            HttpResponseIden::Headers,
            HttpResponseIden::Version,
            HttpResponseIden::RemoteAddr,
        ])
        .values_panic([
            id.as_str().into(),
            CurrentTimestamp.into(),
            CurrentTimestamp.into(),
            req.id.as_str().into(),
            req.workspace_id.as_str().into(),
            elapsed.into(),
            elapsed_headers.into(),
            url.into(),
            serde_json::to_value(state)?.as_str().unwrap_or_default().into(),
            status.into(),
            status_reason.into(),
            content_length.into(),
            body_path.into(),
            serde_json::to_string(&headers)?.into(),
            version.into(),
            remote_addr.into(),
        ])
        .returning_all()
        .build_rusqlite(SqliteQueryBuilder);

    let mut stmt = db.prepare(sql.as_str())?;
    let m: HttpResponse = stmt.query_row(&*params.as_params(), |row| row.try_into())?;
    emit_upserted_model(window, &AnyModel::HttpResponse(m.to_owned()), update_source);
    Ok(m)
}

pub async fn cancel_pending_grpc_connections(app: &AppHandle) -> Result<()> {
    let dbm = &*app.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let closed = serde_json::to_value(&GrpcConnectionState::Closed)?;
    let (sql, params) = Query::update()
        .table(GrpcConnectionIden::Table)
        .values([(GrpcConnectionIden::State, closed.as_str().into())])
        .cond_where(Expr::col(GrpcConnectionIden::State).ne(closed.as_str()))
        .build_rusqlite(SqliteQueryBuilder);

    db.execute(sql.as_str(), &*params.as_params())?;
    Ok(())
}

pub async fn cancel_pending_responses(app: &AppHandle) -> Result<()> {
    let dbm = &*app.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let closed = serde_json::to_value(&GrpcConnectionState::Closed)?;
    let (sql, params) = Query::update()
        .table(HttpResponseIden::Table)
        .values([
            (HttpResponseIden::State, closed.as_str().into()),
            (HttpResponseIden::StatusReason, "Cancelled".into()),
        ])
        .cond_where(Expr::col(HttpResponseIden::State).ne(closed.as_str()))
        .build_rusqlite(SqliteQueryBuilder);

    db.execute(sql.as_str(), &*params.as_params())?;
    Ok(())
}

pub async fn update_response_if_id<R: Runtime>(
    window: &WebviewWindow<R>,
    response: &HttpResponse,
    update_source: &UpdateSource,
) -> Result<HttpResponse> {
    if response.id.is_empty() {
        Ok(response.clone())
    } else {
        update_http_response(window, response, update_source).await
    }
}

pub async fn update_http_response<R: Runtime>(
    window: &WebviewWindow<R>,
    response: &HttpResponse,
    update_source: &UpdateSource,
) -> Result<HttpResponse> {
    let dbm = &*window.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::update()
        .table(HttpResponseIden::Table)
        .cond_where(Expr::col(HttpResponseIden::Id).eq(response.clone().id))
        .values([
            (HttpResponseIden::UpdatedAt, CurrentTimestamp.into()),
            (HttpResponseIden::Elapsed, response.elapsed.into()),
            (HttpResponseIden::Url, response.url.as_str().into()),
            (HttpResponseIden::Status, response.status.into()),
            (
                HttpResponseIden::StatusReason,
                response.status_reason.as_ref().map(|s| s.as_str()).into(),
            ),
            (HttpResponseIden::ContentLength, response.content_length.into()),
            (HttpResponseIden::BodyPath, response.body_path.as_ref().map(|s| s.as_str()).into()),
            (HttpResponseIden::Error, response.error.as_ref().map(|s| s.as_str()).into()),
            (
                HttpResponseIden::Headers,
                serde_json::to_string(&response.headers).unwrap_or_default().into(),
            ),
            (HttpResponseIden::Version, response.version.as_ref().map(|s| s.as_str()).into()),
            (HttpResponseIden::State, serde_json::to_value(&response.state)?.as_str().into()),
            (
                HttpResponseIden::RemoteAddr,
                response.remote_addr.as_ref().map(|s| s.as_str()).into(),
            ),
        ])
        .returning_all()
        .build_rusqlite(SqliteQueryBuilder);

    let mut stmt = db.prepare(sql.as_str())?;
    let m: HttpResponse = stmt.query_row(&*params.as_params(), |row| row.try_into())?;
    emit_upserted_model(window, &AnyModel::HttpResponse(m.to_owned()), update_source);
    Ok(m)
}

pub async fn get_http_response<R: Runtime>(
    mgr: &impl Manager<R>,
    id: &str,
) -> Result<HttpResponse> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(HttpResponseIden::Table)
        .column(Asterisk)
        .cond_where(Expr::col(HttpResponseIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    Ok(stmt.query_row(&*params.as_params(), |row| row.try_into())?)
}

pub async fn delete_http_response<R: Runtime>(
    window: &WebviewWindow<R>,
    id: &str,
    update_source: &UpdateSource,
) -> Result<HttpResponse> {
    let resp = get_http_response(window, id).await?;

    // Delete the body file if it exists
    if let Some(p) = resp.body_path.clone() {
        if let Err(e) = fs::remove_file(p) {
            error!("Failed to delete body file: {}", e);
        };
    }

    let dbm = &*window.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::delete()
        .from_table(HttpResponseIden::Table)
        .cond_where(Expr::col(HttpResponseIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    db.execute(sql.as_str(), &*params.as_params())?;

    emit_deleted_model(window, &AnyModel::HttpResponse(resp.to_owned()), update_source);
    Ok(resp)
}

pub async fn delete_all_http_responses_for_request<R: Runtime>(
    window: &WebviewWindow<R>,
    request_id: &str,
    update_source: &UpdateSource,
) -> Result<()> {
    for r in list_http_responses_for_request(window, request_id, None).await? {
        delete_http_response(window, &r.id, update_source).await?;
    }
    Ok(())
}

pub async fn delete_all_http_responses_for_workspace<R: Runtime>(
    window: &WebviewWindow<R>,
    workspace_id: &str,
    update_source: &UpdateSource,
) -> Result<()> {
    for r in list_http_responses_for_workspace(window, workspace_id, None).await? {
        delete_http_response(window, &r.id, update_source).await?;
    }
    Ok(())
}

pub async fn list_http_responses_for_workspace<R: Runtime>(
    mgr: &impl Manager<R>,
    workspace_id: &str,
    limit: Option<i64>,
) -> Result<Vec<HttpResponse>> {
    let limit_unwrapped = limit.unwrap_or_else(|| i64::MAX);
    let dbm = mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(HttpResponseIden::Table)
        .cond_where(Expr::col(HttpResponseIden::WorkspaceId).eq(workspace_id))
        .column(Asterisk)
        .order_by(HttpResponseIden::CreatedAt, Order::Desc)
        .limit(limit_unwrapped as u64)
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
    Ok(items.map(|v| v.unwrap()).collect())
}

pub async fn list_http_responses_for_request<R: Runtime>(
    mgr: &impl Manager<R>,
    request_id: &str,
    limit: Option<i64>,
) -> Result<Vec<HttpResponse>> {
    let limit_unwrapped = limit.unwrap_or_else(|| i64::MAX);
    let dbm = mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(HttpResponseIden::Table)
        .cond_where(Expr::col(HttpResponseIden::RequestId).eq(request_id))
        .column(Asterisk)
        .order_by(HttpResponseIden::CreatedAt, Order::Desc)
        .limit(limit_unwrapped as u64)
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
    Ok(items.map(|v| v.unwrap()).collect())
}

pub async fn list_responses_by_workspace_id<R: Runtime>(
    mgr: &impl Manager<R>,
    workspace_id: &str,
) -> Result<Vec<HttpResponse>> {
    let dbm = &*mgr.state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();
    let (sql, params) = Query::select()
        .from(HttpResponseIden::Table)
        .cond_where(Expr::col(HttpResponseIden::WorkspaceId).eq(workspace_id))
        .column(Asterisk)
        .order_by(HttpResponseIden::CreatedAt, Order::Desc)
        .build_rusqlite(SqliteQueryBuilder);
    let mut stmt = db.prepare(sql.as_str())?;
    let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
    Ok(items.map(|v| v.unwrap()).collect())
}

pub async fn get_sync_state_for_model<R: Runtime>(
    mgr: &impl Manager<R>,
    workspace_id: &str,
    model_id: &str,
) -> Result<Option<SyncState>> {
    let dbm = &*mgr.state::<SqliteConnection>();
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
    mgr: &impl Manager<R>,
    workspace_id: &str,
    sync_dir: &Path,
) -> Result<Vec<SyncState>> {
    let dbm = &*mgr.state::<SqliteConnection>();
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
    mgr: &impl Manager<R>,
    sync_state: SyncState,
) -> Result<SyncState> {
    let id = match sync_state.id.as_str() {
        "" => generate_model_id(ModelType::TypeSyncState),
        _ => sync_state.id.to_string(),
    };

    let dbm = &*mgr.state::<SqliteConnection>();
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

pub async fn delete_sync_state<R: Runtime>(mgr: &impl Manager<R>, id: &str) -> Result<()> {
    let dbm = &*mgr.app_handle().state::<SqliteConnection>();
    let db = dbm.0.lock().await.get().unwrap();

    let (sql, params) = Query::delete()
        .from_table(SyncStateIden::Table)
        .cond_where(Expr::col(SyncStateIden::Id).eq(id))
        .build_rusqlite(SqliteQueryBuilder);
    db.execute(sql.as_str(), &*params.as_params())?;
    Ok(())
}

pub async fn debug_pool<R: Runtime>(mgr: &impl Manager<R>) {
    let dbm = &*mgr.state::<SqliteConnection>();
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
#[ts(export, export_to = "models.ts")]
pub struct ModelPayload {
    pub model: AnyModel,
    pub window_label: String,
    pub update_source: UpdateSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "models.ts")]
pub enum UpdateSource {
    Sync,
    Window,
    Plugin,
    Background,
    Import,
}

fn emit_upserted_model<R: Runtime>(
    window: &WebviewWindow<R>,
    model: &AnyModel,
    update_source: &UpdateSource,
) {
    let payload = ModelPayload {
        model: model.to_owned(),
        window_label: window.label().to_string(),
        update_source: update_source.to_owned(),
    };

    window.emit("upserted_model", payload).unwrap();
}

fn emit_deleted_model<R: Runtime>(
    window: &WebviewWindow<R>,
    model: &AnyModel,
    update_source: &UpdateSource,
) {
    let payload = ModelPayload {
        model: model.to_owned(),
        window_label: window.label().to_string(),
        update_source: update_source.to_owned(),
    };
    window.emit("deleted_model", payload).unwrap();
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
}

pub async fn batch_upsert<R: Runtime>(
    window: &WebviewWindow<R>,
    workspaces: Vec<Workspace>,
    environments: Vec<Environment>,
    folders: Vec<Folder>,
    http_requests: Vec<HttpRequest>,
    grpc_requests: Vec<GrpcRequest>,
    update_source: &UpdateSource,
) -> Result<BatchUpsertResult> {
    let mut imported_resources = BatchUpsertResult::default();

    if workspaces.len() > 0 {
        for v in workspaces {
            let x = upsert_workspace(&window, v, update_source).await?;
            imported_resources.workspaces.push(x.clone());
        }
        info!("Imported {} workspaces", imported_resources.workspaces.len());
    }

    if environments.len() > 0 {
        while imported_resources.environments.len() < environments.len() {
            for v in environments.clone() {
                if let Some(fid) = v.environment_id.clone() {
                    let imported_parent =
                        imported_resources.environments.iter().find(|f| f.id == fid);
                    if imported_parent.is_none() {
                        continue;
                    }
                }
                if let Some(_) = imported_resources.environments.iter().find(|f| f.id == v.id) {
                    continue;
                }
                let x = upsert_environment(&window, v, update_source).await?;
                imported_resources.environments.push(x.clone());
            }
        }
        info!("Imported {} environments", imported_resources.environments.len());
    }

    if folders.len() > 0 {
        while imported_resources.folders.len() < folders.len() {
            for v in folders.clone() {
                if let Some(fid) = v.folder_id.clone() {
                    let imported_parent = imported_resources.folders.iter().find(|f| f.id == fid);
                    if imported_parent.is_none() {
                        continue;
                    }
                }
                if let Some(_) = imported_resources.folders.iter().find(|f| f.id == v.id) {
                    continue;
                }
                let x = upsert_folder(&window, v, update_source).await?;
                imported_resources.folders.push(x.clone());
            }
        }
        info!("Imported {} folders", imported_resources.folders.len());
    }

    if http_requests.len() > 0 {
        for v in http_requests {
            let x = upsert_http_request(&window, v, update_source).await?;
            imported_resources.http_requests.push(x.clone());
        }
        info!("Imported {} http_requests", imported_resources.http_requests.len());
    }

    if grpc_requests.len() > 0 {
        for v in grpc_requests {
            let x = upsert_grpc_request(&window, v, update_source).await?;
            imported_resources.grpc_requests.push(x.clone());
        }
        info!("Imported {} grpc_requests", imported_resources.grpc_requests.len());
    }

    Ok(imported_resources)
}

pub async fn get_workspace_export_resources<R: Runtime>(
    mgr: &impl Manager<R>,
    workspace_ids: Vec<&str>,
) -> WorkspaceExport {
    let mut data = WorkspaceExport {
        yaak_version: mgr.package_info().version.clone().to_string(),
        yaak_schema: 2,
        timestamp: Utc::now().naive_utc(),
        resources: BatchUpsertResult {
            workspaces: Vec::new(),
            environments: Vec::new(),
            folders: Vec::new(),
            http_requests: Vec::new(),
            grpc_requests: Vec::new(),
        },
    };

    for workspace_id in workspace_ids {
        data.resources
            .workspaces
            .push(get_workspace(mgr, workspace_id).await.expect("Failed to get workspace"));
        data.resources.environments.append(
            &mut list_environments(mgr, workspace_id).await.expect("Failed to get environments"),
        );
        data.resources
            .folders
            .append(&mut list_folders(mgr, workspace_id).await.expect("Failed to get folders"));
        data.resources.http_requests.append(
            &mut list_http_requests(mgr, workspace_id).await.expect("Failed to get http requests"),
        );
        data.resources.grpc_requests.append(
            &mut list_grpc_requests(mgr, workspace_id).await.expect("Failed to get grpc requests"),
        );
    }

    data
}

// Generate the created_at or updated_at timestamps for an upsert operation, depending on the ID
// provided.
fn timestamp_for_upsert(update_source: &UpdateSource, dt: NaiveDateTime) -> NaiveDateTime {
    match update_source {
        // Sync and import operations always preserve timestamps
        UpdateSource::Sync | UpdateSource::Import => {
            if dt.and_utc().timestamp() == 0 {
                // Sometimes data won't have timestamps (partial data)
                Utc::now().naive_utc()
            } else {
                dt
            }
        }
        // Other sources will always update to the latest time
        _ => Utc::now().naive_utc(),
    }
}
