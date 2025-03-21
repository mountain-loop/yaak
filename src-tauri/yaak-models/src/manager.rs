use crate::error::Result;
use crate::models::{
    AnyModel, GrpcEventIden, HttpRequest, HttpRequestIden, ModelType, Workspace, WorkspaceIden,
};
use crate::queries::{generate_model_id, ModelPayload, UpdateSource};
use r2d2::{Pool, PooledConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{Connection, Transaction};
use sea_query::{Asterisk, OnConflict, Order, Query, SqliteQueryBuilder};
use sea_query_rusqlite::RusqliteBinder;
use std::sync::{mpsc, Arc, Mutex};
use tauri::{AppHandle, Manager, Runtime, State};

pub trait QueryManagerExt<'a, R> {
    fn queries(&'a self) -> State<'a, QueryManager>;
}

impl<'a, R: Runtime> QueryManagerExt<'a, R> for AppHandle<R> {
    fn queries(&'a self) -> State<'a, QueryManager> {
        let qm = self.state::<QueryManager>();
        qm
    }
}
#[derive(Clone)]
pub struct QueryManager {
    pool: Arc<Mutex<Pool<SqliteConnectionManager>>>,
    events_tx: Arc<Mutex<mpsc::Sender<ModelPayload>>>,
}

impl QueryManager {
    pub(crate) fn new(
        pool: Pool<SqliteConnectionManager>,
        events_tx: mpsc::Sender<ModelPayload>,
    ) -> Self {
        QueryManager {
            pool: Arc::new(Mutex::new(pool)),
            events_tx: Arc::new(Mutex::new(events_tx)),
        }
    }

    pub fn connect(&self) -> Result<DbContext> {
        let conn = self.pool.lock().unwrap().get()?;
        Ok(DbContext {
            tx: self.events_tx.lock().unwrap().clone(),
            conn: ConnectionOrTx::Connection(conn),
        })
    }

    pub fn with_tx<F, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&DbContext) -> Result<T>,
    {
        let mut conn = self.pool.lock().unwrap().get()?;
        let tx = conn.transaction()?;
        let db_context = DbContext {
            tx: self.events_tx.lock().unwrap().clone(),
            conn: ConnectionOrTx::Transaction(&tx),
        };
        let result = f(&db_context);
        match result {
            Ok(val) => {
                tx.commit()?;
                Ok(val)
            }
            // rollback is automatic on drop of value
            e => e,
        }
    }
}

pub enum ConnectionOrTx<'a> {
    Connection(PooledConnection<SqliteConnectionManager>),
    Transaction(&'a Transaction<'a>),
}

impl<'a> ConnectionOrTx<'a> {
    fn conn(&self) -> &Connection {
        match self {
            ConnectionOrTx::Connection(c) => c,
            ConnectionOrTx::Transaction(c) => c,
        }
    }
}

pub struct DbContext<'a> {
    tx: mpsc::Sender<ModelPayload>,
    conn: ConnectionOrTx<'a>,
}

impl<'a> DbContext<'a> {
    pub fn list_workspaces(&self) -> Result<Vec<Workspace>> {
        let (sql, params) = Query::select()
            .from(WorkspaceIden::Table)
            .column(Asterisk)
            .order_by(WorkspaceIden::Name, Order::Asc)
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn.conn().prepare(sql.as_str())?;
        let items = stmt.query_map(&*params.as_params(), |row| row.try_into())?;
        Ok(items.map(|v| v.unwrap()).collect())
    }

    pub fn upsert_http_request(
        &self,
        request: HttpRequest,
        update_source: &UpdateSource,
    ) -> Result<HttpRequest> {
        let id = match request.id.as_str() {
            "" => generate_model_id(ModelType::TypeHttpRequest),
            _ => request.id.to_string(),
        };
        let trimmed_name = request.name.trim();

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
                crate::queries::timestamp_for_upsert(update_source, request.created_at).into(),
                crate::queries::timestamp_for_upsert(update_source, request.updated_at).into(),
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

        let mut stmt = self.conn.conn().prepare(sql.as_str())?;
        let m: HttpRequest = stmt.query_row(&*params.as_params(), |row| row.try_into())?;
        self.tx
            .send(ModelPayload {
                model: AnyModel::HttpRequest(m.to_owned()),
                update_source: update_source.clone(),
            })
            .unwrap();
        Ok(m)
    }
}
